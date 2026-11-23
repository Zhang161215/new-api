package router

import (
	"fmt"

	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

func SetTaskPluginProtocolRouter(router *gin.Engine) {
	for _, protocol := range pluginruntime.HostProtocols() {
		for _, operation := range protocol.Operations {
			for _, method := range operation.Methods {
				handlers, err := taskPluginProtocolHandlers(protocol.Name, operation.Name)
				if err != nil {
					panic(err)
				}
				router.Handle(method, operation.Path, handlers...)
			}
		}
	}
}

func taskPluginProtocolHandlers(protocol, operation string) ([]gin.HandlerFunc, error) {
	switch protocol + "." + operation {
	case "openai_responses.create":
		// 本站定制：上游 rc.27 把 POST /v1/responses 从 relay 路由组挪到这里，链上没有我们的前置提示词审核，
		// 要补上（位置同原来：Distribute 之后），否则 Codex/Responses 流量会绕过审核。
		return []gin.HandlerFunc{
			middleware.RouteTag("relay"), middleware.SystemPerformanceCheck(), middleware.TokenAuth(),
			middleware.ModelRequestRateLimit(), middleware.RouteTaskPluginEndpoint(), middleware.PrepareTaskPluginEndpoint(), middleware.Distribute(),
			middleware.PromptAudit(),
			func(c *gin.Context) {
				controller.RelayTaskPluginEndpoint(c, func(c *gin.Context) { controller.Relay(c, types.RelayFormatOpenAIResponses) })
			},
		}, nil
	case "openai_image.generate", "openai_image.edit":
		return []gin.HandlerFunc{
			middleware.RouteTag("relay"), middleware.SystemPerformanceCheck(), middleware.TokenAuth(),
			middleware.ModelRequestRateLimit(), middleware.RouteTaskPluginEndpoint(), middleware.PrepareTaskPluginEndpoint(), middleware.Distribute(),
			func(c *gin.Context) {
				controller.RelayTaskPluginEndpoint(c, func(c *gin.Context) { controller.Relay(c, types.RelayFormatOpenAIImage) })
			},
		}, nil
	case "openai_video.create":
		return []gin.HandlerFunc{
			middleware.RouteTag("relay"), middleware.TokenAuth(), middleware.SystemPerformanceCheck(),
			middleware.RouteTaskPluginEndpoint(), middleware.TaskPluginEndpointOnly(middleware.ModelRequestRateLimit()), middleware.PrepareTaskPluginEndpoint(), middleware.Distribute(),
			func(c *gin.Context) { controller.RelayTaskPluginEndpoint(c, controller.RelayTask) },
		}, nil
	case "openai_responses.retrieve":
		return []gin.HandlerFunc{middleware.RouteTag("relay"), middleware.TokenAuth(), controller.RetrieveTaskPluginResponse}, nil
	case "openai_video.retrieve":
		return []gin.HandlerFunc{middleware.RouteTag("relay"), middleware.TokenAuth(), defaultPluginDispatcher.handOffNativeTaskQuery, middleware.Distribute(), controller.RelayTaskFetch}, nil
	case "openai_video.content":
		return []gin.HandlerFunc{middleware.RouteTag("relay"), middleware.TokenAuth(), controller.VideoProxy}, nil
	default:
		return nil, fmt.Errorf("host protocol registry operation %s.%s has no handler", protocol, operation)
	}
}
