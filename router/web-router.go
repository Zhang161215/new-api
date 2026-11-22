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
	"github.com/gin-contrib/static"
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

func SetWebRouter(router *gin.Engine, assets WebAssets) {
	defaultFS := common.EmbedFolder(assets.BuildFS, "web/dist")
	classicFS := common.EmbedFolder(assets.ClassicBuildFS, "web/classic/dist")
	frontendFS := common.NewThemeAwareFS(defaultFS, classicFS)

	router.Use(gzip.Gzip(gzip.DefaultCompression))
	router.Use(middleware.GlobalWebRateLimit())
	router.Use(middleware.Cache())
	mountLiveLottery(router)
	router.Use(static.Serve("/", frontendFS))
	router.NoRoute(func(c *gin.Context) {
		c.Set(middleware.RouteTagKey, "web")
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
	})
}

func mountLiveLottery(router *gin.Engine) {
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
		router.Use(func(c *gin.Context) {
			if strings.HasPrefix(c.Request.URL.Path, "/lottery") {
				c.Header("Cache-Control", "no-store")
				c.Header("X-Frame-Options", "SAMEORIGIN")
				c.Header("Content-Security-Policy", "frame-ancestors 'self'")
			}
			c.Next()
		})
		router.Static("/lottery", dir)
		common.SysLog("serving lottery pages from " + dir)
		return
	}
}
