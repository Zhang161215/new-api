package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

func Cache() func(c *gin.Context) {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/assets/") {
			c.Header("Cache-Control", "public, max-age=604800, immutable")
		} else {
			// HTML / SPA 入口不能长缓存：发版后旧 index.html 会指向已不存在的 hashed JS，页面空白。
			c.Header("Cache-Control", "no-store")
		}
		c.Header("Cache-Version", "b688f2fb5be447c25e5aa3bd063087a83db32a288bf6a4f35f2d8db310e40b14")
		c.Next()
	}
}
