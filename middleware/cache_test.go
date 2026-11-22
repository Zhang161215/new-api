package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestCacheHashedAssetsAreImmutable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := map[string]string{
		"/static/js/index.75e71417d9.js":                 "public, max-age=604800, immutable",
		"/static/js/async/123.abcdef0123.js":             "public, max-age=604800, immutable",
		"/static/css/index.88065e8196.css":               "public, max-age=604800, immutable",
		"/static/font/KaTeX_AMS-Regular.1608a09b4a.woff": "public, max-age=604800, immutable",
		"/assets/index-abc123.js":                        "public, max-age=604800, immutable",
		"/static/logo-circle.png":                        "no-store",
		"/":                                              "no-store",
		"/console/topup":                                 "no-store",
	}
	for path, want := range cases {
		r := gin.New()
		r.Use(Cache())
		r.GET("/*any", func(c *gin.Context) { c.Status(http.StatusOK) })
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, want, w.Header().Get("Cache-Control"), path)
	}
}
