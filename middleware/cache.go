package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

func Cache() func(c *gin.Context) {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if isHashedStaticAsset(path) {
			c.Header("Cache-Control", "public, max-age=604800, immutable")
		} else {
			// HTML / SPA 入口不能长缓存：发版后旧 index.html 会指向已不存在的 hashed JS，页面空白。
			c.Header("Cache-Control", "no-store")
		}
		c.Header("Cache-Version", "b688f2fb5be447c25e5aa3bd063087a83db32a288bf6a4f35f2d8db310e40b14")
		c.Next()
	}
}

// 文件名带内容哈希的构建产物可以长缓存：vite 的 /assets/，以及 rsbuild（rc.21 起 classic 和新版都用）的
// /static/js、/static/css、/static/font。/static 下其他文件（logo 等）不带哈希，不能长缓存。
func isHashedStaticAsset(path string) bool {
	for _, prefix := range []string{"/assets/", "/static/js/", "/static/css/", "/static/font/"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}
