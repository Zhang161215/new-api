package model

// 数据看板的 Token 口径（本站统一规则）：
//
//	输入 = 非缓存输入 + 缓存读取 + 缓存创建（模型实际处理的全部输入）
//	输出 = completion
//	总 Token = 输入 + 输出
//
// 缓存读取 / 缓存创建是输入的组成部分，单独再展示一次，不额外加进总数。
//
// 各家 usage 的 prompt_tokens 含义不一样：Anthropic 语义（/v1/messages、Claude 渠道、OpenRouter Claude）
// 只含非缓存输入，要把缓存加回去；OpenAI / Gemini 语义本来就包含缓存，不能重复加。
// 上游原来直接用 prompt+completion，Claude 请求的缓存全部漏算，所以单独收口在这里。

// dashboardInputTokens 返回看板口径的输入 Token。
// 结算路径（text_quota）知道确切语义时会直接给出 InputTokensTotal；其他路径按日志里的语义标记推断。
func dashboardInputTokens(params RecordConsumeLogParams, other *LogOther, cacheReadTokens, cacheWriteTokens int) int {
	if params.InputTokensTotal > 0 {
		return params.InputTokensTotal
	}
	if logPromptExcludesCache(other) {
		return params.PromptTokens + max(0, cacheReadTokens) + max(0, cacheWriteTokens)
	}
	return params.PromptTokens
}

// logPromptExcludesCache 日志是否按 Anthropic 语义记录（prompt_tokens 不含缓存）。
func logPromptExcludesCache(other *LogOther) bool {
	if other == nil || other.public == nil {
		return false
	}
	if claude, _ := other.public["claude"].(bool); claude {
		return true
	}
	semantic, _ := other.public["usage_semantic"].(string)
	return semantic == "anthropic"
}
