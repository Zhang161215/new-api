package router

import (
	"embed"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

// WebAssets holds the embedded dashboard frontend assets.
// 本站同时 embed 上游新版前端（web/dist）和 classic（web/classic/dist），按 theme.frontend 切换，默认 classic。
type WebAssets struct {
	BuildFS          embed.FS
	IndexPage        []byte
	ClassicBuildFS   embed.FS
	ClassicIndexPage []byte
}

func SetWebRouter(router *gin.Engine, assets WebAssets, pluginDispatcher gin.HandlerFunc) {
	defaultFS := common.EmbedFolder(assets.BuildFS, "web/dist")
	classicFS := common.EmbedFolder(assets.ClassicBuildFS, "web/classic/dist")
	frontendFS := common.NewThemeAwareFS(defaultFS, classicFS)
	compress := gzip.Gzip(gzip.DefaultCompression)
	// 本站：ServeFrontendFiles 按 URL 路径缓存压缩结果，两套前端各用一份缓存，
	// 否则运行中切换主题后 /favicon.ico 这类同名文件会继续返回另一套的内容。
	serveDefaultFiles := middleware.ServeFrontendFiles(defaultFS)
	serveClassicFiles := middleware.ServeFrontendFiles(classicFS)
	serveFrontendFiles := func(c *gin.Context) {
		if common.GetTheme() == "classic" {
			serveClassicFiles(c)
			return
		}
		serveDefaultFiles(c)
	}

	webMiddlewares := []gin.HandlerFunc{
		middleware.RouteTag("web"),
		func(c *gin.Context) {
			// ServeFrontendFiles sends build files already compressed.
			if !frontendFS.Exists("/", c.Request.URL.Path) {
				compress(c)
			}
		},
		middleware.AccessTokenAudit(),
		middleware.GlobalWebRateLimit(frontendFS),
		middleware.Cache(),
	}
	mountLiveLottery(router, webMiddlewares)

	noRoute := append([]gin.HandlerFunc{pluginDispatcher}, webMiddlewares...)
	noRoute = append(noRoute,
		serveFrontendFiles,
		func(c *gin.Context) {
			if strings.HasPrefix(c.Request.RequestURI, "/v1") || strings.HasPrefix(c.Request.RequestURI, "/api") || strings.HasPrefix(c.Request.RequestURI, "/assets") {
				controller.RelayNotFound(c)
				return
			}
			c.Header("Cache-Control", "no-cache")
			if common.GetTheme() == "classic" {
				c.Data(http.StatusOK, "text/html; charset=utf-8", assets.ClassicIndexPage)
			} else {
				c.Data(http.StatusOK, "text/html; charset=utf-8", assets.IndexPage)
			}
		},
	)
	router.NoRoute(noRoute...)
}

func mountLiveLottery(router *gin.Engine, webMiddlewares []gin.HandlerFunc) {
	candidates := []string{filepath.Join("web", "classic", "public", "lottery")}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "web", "classic", "public", "lottery"),
			filepath.Join(dir, "..", "web", "classic", "public", "lottery"),
		)
	}
	for _, dir := range candidates {
		st, err := os.Stat(dir)
		if err != nil || !st.IsDir() {
			continue
		}
		// 上游 rc.27 起前端的 gzip/限流/缓存头都挂在 NoRoute 链上，不再是全局 Use；
		// 抽奖页是注册的路由，要自己带上这几个中间件（顺序同前：先 Cache，再用 no-store 覆盖）。
		handlers := append(append([]gin.HandlerFunc{}, webMiddlewares...), func(c *gin.Context) {
			c.Header("Cache-Control", "no-store")
			c.Header("X-Frame-Options", "SAMEORIGIN")
			c.Header("Content-Security-Policy", "frame-ancestors 'self'")
			c.Next()
		})
		router.Group("/lottery", handlers...).Static("/", dir)
		common.SysLog("serving lottery pages from " + dir)
		return
	}
}
