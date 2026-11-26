package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// takeQuotaDataCache 取出并清空看板缓存里这个用户的记录（同一用户同一小时只会有一条）。
func takeQuotaDataCache(t *testing.T, userID int) *model.QuotaData {
	t.Helper()
	model.CacheQuotaDataLock.Lock()
	defer model.CacheQuotaDataLock.Unlock()
	var found *model.QuotaData
	for key, row := range model.CacheQuotaData {
		if row.UserID == userID {
			require.Nil(t, found, "same user should aggregate into one row")
			found = row
			delete(model.CacheQuotaData, key)
		}
	}
	require.NotNil(t, found)
	return found
}

// 看板口径：输入 = 非缓存输入 + 缓存读取 + 缓存创建，总 Token = 输入 + 输出，三种用量语义一致。
func TestPostTextConsumeQuotaDashboardTokensIncludeCache(t *testing.T) {
	truncate(t)
	prevExport := common.DataExportEnabled
	common.DataExportEnabled = true
	t.Cleanup(func() { common.DataExportEnabled = prevExport })
	gin.SetMode(gin.TestMode)

	price := hosttypes.PriceData{
		ModelRatio: 1, CompletionRatio: 5, CacheRatio: 0.1,
		CacheCreationRatio: 1.25, CacheCreation5mRatio: 1.25, CacheCreation1hRatio: 2,
		GroupRatioInfo: hosttypes.GroupRatioInfo{GroupRatio: 1},
	}
	cases := []struct {
		name       string
		userID     int
		format     types.RelayFormat
		model      string
		usage      *dto.Usage
		wantInput  int64
		wantOutput int64
		wantRead   int64
		wantWrite  int64
	}{
		{
			// /v1/messages：input_tokens 只含非缓存输入，缓存要加回去
			name: "anthropic", userID: 71, format: types.RelayFormatClaude, model: "claude-opus-4-5",
			usage: &dto.Usage{
				PromptTokens: 100, CompletionTokens: 50,
				PromptTokensDetails:         dto.InputTokenDetails{CachedTokens: 5000, CachedCreationTokens: 400},
				ClaudeCacheCreation5mTokens: 400,
			},
			wantInput: 5500, wantOutput: 50, wantRead: 5000, wantWrite: 400,
		},
		{
			// OpenAI Responses：input_tokens 已含缓存读取与写入，不能重复加
			name: "openai", userID: 72, format: types.RelayFormatOpenAIResponses, model: "gpt-5.1-codex",
			usage: &dto.Usage{
				PromptTokens: 12000, CompletionTokens: 300,
				PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 4000, CacheWriteTokens: 7000},
			},
			wantInput: 12000, wantOutput: 300, wantRead: 4000, wantWrite: 7000,
		},
		{
			// 旧版 Claude 派生的 OpenAI 用量：按 Claude 计费（prompt 不含缓存），看板同样加回去
			name: "legacy claude derived", userID: 73, format: types.RelayFormatOpenAI, model: "claude-3-7-sonnet",
			usage: &dto.Usage{
				PromptTokens: 62, CompletionTokens: 95,
				PromptTokensDetails:         dto.InputTokenDetails{CachedTokens: 3544},
				ClaudeCacheCreation5mTokens: 586,
			},
			wantInput: 62 + 3544 + 586, wantOutput: 95, wantRead: 3544, wantWrite: 586,
		},
		{
			// 没有缓存的普通请求：口径不变
			name: "no cache", userID: 74, format: types.RelayFormatOpenAI, model: "deepseek-v4",
			usage:     &dto.Usage{PromptTokens: 800, CompletionTokens: 200},
			wantInput: 800, wantOutput: 200,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			user := &model.User{Id: tc.userID, Username: "dash_" + tc.name, AffCode: "dash_" + tc.name, Quota: 10_000_000, Status: common.UserStatusEnabled}
			require.NoError(t, model.DB.Create(user).Error)
			seedChannel(t, tc.userID)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("POST", "/v1/messages", nil)
			info := &relaycommon.RelayInfo{
				UserId:          tc.userID,
				OriginModelName: tc.model,
				UsingGroup:      "default",
				StartTime:       time.Now(),
				RelayFormat:     tc.format,
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: tc.userID},
				PriceData:       price,
			}

			PostTextConsumeQuota(ctx, info, tc.usage, nil)

			row := takeQuotaDataCache(t, tc.userID)
			require.Equal(t, tc.wantInput, row.InputTokens)
			require.Equal(t, tc.wantOutput, row.OutputTokens)
			require.Equal(t, int(tc.wantInput+tc.wantOutput), row.TokenUsed)
			require.Equal(t, tc.wantRead, row.CacheReadTokens)
			require.Equal(t, tc.wantWrite, row.CacheCreationTokens)

			// 使用日志的 prompt_tokens 保持原样（按各家协议），只有看板口径统一
			log := getLastLog(t)
			require.NotNil(t, log)
			require.Equal(t, tc.usage.PromptTokens, log.PromptTokens)
		})
	}
}
