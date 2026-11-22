package openai

// 本站定制（从 relay-openai.go 移出，便于以后合并上游）：
//   - 生图结果 URL 改写到本域 /go2img（A10），在 OpenaiImageHandler / OpenaiImageStreamHandler 里调用；
//   - 流式 finish_reason 观测，供截断流判定和模型广场可用率使用。

import (
	"bytes"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

const go2apiImageHost = "tu.go2api.cc"
const go2imgPrefix = "/go2img"

// 生图 JSON 里出现过的上游图床。go2api 仍走 /go2img/...；其它站走 /go2img/h/<host>/...
var imageCDNHosts = []struct {
	host       string
	pathPrefix string
}{
	{go2apiImageHost, ""},
	{"note0.17zz.xyz", "/h/note0.17zz.xyz"},
	{"note1.17zz.xyz", "/h/note1.17zz.xyz"},
	{"dnznrvs05pmza.cloudfront.net", "/h/dnznrvs05pmza.cloudfront.net"},
}

func publicImageProxyPrefix(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	if host == "" {
		return ""
	}
	proto := c.GetHeader("X-Forwarded-Proto")
	if proto != "http" && proto != "https" {
		proto = "https"
	}
	return proto + "://" + host + go2imgPrefix
}

// 把上游图链改到本域 /go2img，顺带去掉 http://。
// 否则客户端会看到 tu.go2api.cc / note1.17zz.xyz，且 http 链接会被 301 / 混合内容拦掉。
func rewriteUpstreamImageURLs(body []byte, publicPrefix string) []byte {
	if len(body) == 0 {
		return body
	}
	if publicPrefix != "" {
		changed := false
		out := body
		for _, cdn := range imageCDNHosts {
			httpHost := "http://" + cdn.host
			httpsHost := "https://" + cdn.host
			if !bytes.Contains(out, []byte(cdn.host)) {
				continue
			}
			dest := publicPrefix + cdn.pathPrefix
			out = bytes.ReplaceAll(out, []byte(httpHost), []byte(dest))
			out = bytes.ReplaceAll(out, []byte(httpsHost), []byte(dest))
			changed = true
		}
		if changed {
			out = unescapeJSONAmpersands(out)
			return out
		}
	}
	if bytes.Contains(body, []byte(`\u0026`)) {
		body = unescapeJSONAmpersands(body)
	}
	if !bytes.Contains(body, []byte("http://")) {
		return body
	}
	out := bytes.ReplaceAll(body, []byte(`"url":"http://`), []byte(`"url":"https://`))
	out = bytes.ReplaceAll(out, []byte(`"url": "http://`), []byte(`"url": "https://`))
	return unescapeJSONAmpersands(out)
}

// encoding/json HTML-escapes & as \u0026; regex URL scrapers then 401 on 17zz signed links.
func unescapeJSONAmpersands(body []byte) []byte {
	if !bytes.Contains(body, []byte(`\u0026`)) {
		return body
	}
	return bytes.ReplaceAll(body, []byte(`\u0026`), []byte("&"))
}

// observeStreamFinishReason 见到 finish_reason 即视为协议终态；content_filter 属于业务拒绝，不计入可用率。移植自上游。
func observeStreamFinishReason(info *relaycommon.RelayInfo, data string) {
	if info == nil || info.StreamStatus == nil || !strings.Contains(data, "finish_reason") {
		return
	}
	for _, reason := range gjson.Get(data, "choices.#.finish_reason").Array() {
		value := reason.String()
		if value == "" {
			continue
		}
		if value == constant.FinishReasonContentFilter {
			info.PerformanceBusinessRejection = true
		}
		info.StreamStatus.MarkCompleted()
	}
}
