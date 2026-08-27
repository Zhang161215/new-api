# 修复：`tool_search_call.arguments` 被改成字符串导致 400

日期：2026-08-27  
环境：线上 NewAPI `23.80.82.170`（`api.synai996.space`）→ 渠道 99 `cpa.synai996.space`（官方 CPA v7.2.137）  
当前镜像：`new-api:deploy-v3-codexargs-202608271110`  
相关 commit：`27c7b1ef`（Codex Responses 流兼容上游把 `function_call.arguments` 发成对象）

---

## 1. 用户报错

```json
{
  "error": {
    "message": "Invalid type for 'input[255].arguments': expected an object, but got a string instead.",
    "type": "invalid_request_error",
    "param": "input[255].arguments",
    "code": "invalid_type"
  }
}
```

这是 **ChatGPT Codex 上游** 返回的 400。CPA 只是原样转发，不是 CPA 自己校验失败。

长会话更容易中招。对上的那条请求 `input` 已有 259 项，失败项是 `input[255]`。客户端会带着错误类型的历史重试，表现为连续 400。

---

## 2. 结论（先看这个）

| 问题 | 结论 |
|---|---|
| 谁报的错 | ChatGPT Codex 上游 |
| CPA 有没有改这段字段 | 没有。CPA 收到的请求体里已经是字符串 |
| 根因在哪 | **NewAPI** 回包规范化把所有 `arguments` 对象都改成了字符串 |
| 用户怎么止血 | 开新会话（旧会话历史已被污染） |
| 正确修法 | 只对 `function_call` 字符串化；`tool_search_call` 保持 / 还原为对象 |

---

## 3. 根因

Responses 里两种 `arguments` 规则不一样：

| `type` | `arguments` 合法类型 | 说明 |
|---|---|---|
| `function_call` | **string**（JSON 文本） | 官方 Responses / Codex serde 要求字符串。上游有时会发对象，需要转成字符串 |
| `tool_search_call` | **object** | ChatGPT Codex 要求对象。发字符串会 400 |

线上对上的请求体（CPA 错误日志，请求已到达 CPA）：

- `function_call:str` × 55（合法）
- `tool_search_call:str` × 1，位于 `input[255]`（非法，触发本次 400）

`27c7b1ef` 引入 `NormalizeResponsesFunctionArguments`，注释写的是修 `function_call`，实现却是：

> 只要 JSON 节点上有 `arguments` 且值是 object/array，就 `json.Marshal` 成 **string**。

没有看旁边的 `type`。于是 `tool_search_call.arguments` 也被改成字符串。

流程：

```
ChatGPT 回包：tool_search_call.arguments = { "query": "...", "limit": 10 }
        ↓
NewAPI NormalizeResponsesFunctionArguments（回包 SSE / 非流 body）
        ↓
客户端收到：arguments = "{\"query\":\"...\",\"limit\":10}"
        ↓
下一轮把历史放进 input 原样带回
        ↓
ChatGPT：expected an object, but got a string  →  400
```

这是已知坑：

- https://github.com/openai/codex/issues/31517
- https://github.com/Wei-Shaw/sub2api/issues/3818（结论：只有 `tool_search_call` 的 arguments 不能用 string，其它类型可以；从 string parse 成 JSON 再写回去）

渠道 99 当前 `pass_through_body_enabled` 为 **false**（2026-08-25 仍为 true）。关掉透传后更容易走到规范化逻辑。透传挡不住 **回包** 这条路径，所以只开透传不能根治。

---

## 4. 代码位置

回包规范化（当前过宽）：

- `dto/openai_response.go`
  - `NormalizeResponsesFunctionArguments`
  - `normalizeArgumentsValue`（真正改 `arguments` 的地方）
- 调用点（都走回包，不要误删 `function_call` 的字符串化）：
  - `relay/channel/openai/relay_responses.go`（非流 body + SSE）
  - `relay/channel/openai/chat_via_responses.go`（chat 走 responses）
- 现有测试：`dto/openai_response_arguments_test.go`
  - 只覆盖了 `function_call` 对象 → 字符串
  - **没有**覆盖 `tool_search_call` 必须保持对象

请求出站（目前不会把 string 还原成 object）：

- `relay/responses_handler.go`
  - `pass_through` 为 true：原 body 直出
  - 为 false：`ConvertOpenAIResponsesRequest` → `Marshal` → `RemoveDisabledFields` → param override
  - `OpenAIResponsesRequest.Input` 是 `json.RawMessage`，`RemoveDisabledFields` 用 `map` 再 Marshal，**不会**把 object 变成 string，也 **不会**把 string 还原成 object
- 因此：已经被污染的会话，还需要在 **发往 CPA 之前** 把 `tool_search_call.arguments` 从 JSON 字符串还原成对象

当前过宽实现（摘录）：

```go
func normalizeArgumentsValue(v any) bool {
    // ...
    case map[string]any:
        if args, ok := x["arguments"]; ok {
            switch a := args.(type) {
            case map[string]any, []any:
                if b, err := json.Marshal(a); err == nil {
                    x["arguments"] = string(b) // 所有 type 都会进来，包括 tool_search_call
                    changed = true
                }
            }
        }
    // ...
}
```

---

## 5. 应该怎么改

两层一起做。只做回包，新会话好了，旧会话仍 400。

### 5.1 回包：只字符串化 `function_call`

改 `normalizeArgumentsValue`：仅当 `x["type"] == "function_call"` 时，才把 object/array 的 `arguments` 变成 string。

`tool_search_call`（以及其它类型）保持原样。

建议伪代码：

```go
func normalizeArgumentsValue(v any) bool {
    changed := false
    switch x := v.(type) {
    case map[string]any:
        typeName, _ := x["type"].(string)
        if typeName == "function_call" {
            if args, ok := x["arguments"]; ok {
                switch a := args.(type) {
                case map[string]any, []any:
                    if b, err := json.Marshal(a); err == nil {
                        x["arguments"] = string(b)
                        changed = true
                    }
                }
            }
        }
        for k, child := range x {
            if k == "arguments" {
                continue
            }
            if normalizeArgumentsValue(child) {
                changed = true
            }
        }
    case []any:
        for _, child := range x {
            if normalizeArgumentsValue(child) {
                changed = true
            }
        }
    }
    return changed
}
```

SSE 里常见形态：

```json
{"type":"response.output_item.done","item":{"type":"function_call","arguments":{...}}}
{"type":"response.output_item.done","item":{"type":"tool_search_call","arguments":{...}}}
```

`arguments` 在嵌套的 `item` 上，递归仍然需要，只是叶子上加 `type` 判断。

### 5.2 请求：发上游前把 `tool_search_call.arguments` 还原成对象

新增类似 `CoerceToolSearchCallArguments(jsonData []byte) []byte`（名字自定）：

- 遍历 `input` 数组（以及可能出现的其它嵌套位置）
- 若 `type == "tool_search_call"` 且 `arguments` 是 string
- 且该 string 能 `json.Unmarshal` 成 object（或 array）
- 则写成 object 再 Marshal 回去
- 解析失败：保持原样，不要猜

挂在 `relay/responses_handler.go` 请求出站路径上，**透传和和非透传都要走**（污染发生在客户端历史里，透传也会原样带上来）：

1. pass_through：读到 raw body 之后、`DoRequest` 之前
2. 非 pass_through：`RemoveDisabledFields` / param override 之后、`bytes.NewBuffer` 之前

这样已经 400 的旧会话，下一轮有机会自动修好，不必全员开新聊天。

### 5.3 渠道（加固，不能单独当根治）

渠道 99 把 `pass_through_body_enabled` 改回 `true`。减少 NewAPI 改写请求体。  
**挡不住回包规范化**，必须和 5.1 一起。

### 5.4 不要做的

- 不要全局删掉 `NormalizeResponsesFunctionArguments`。`function_call` 对象 → 字符串仍需要，否则部分 Codex 客户端会挂。
- 不要在 CPA 上修。官方 CPA 只是把 NewAPI 送来的 body 交给 ChatGPT。
- 不要只让用户开新会话当长期方案。

---

## 6. 测试（请补在 `dto/openai_response_arguments_test.go`）

现有用例保留：`function_call` + 对象 arguments → 变成 string。

新增至少：

1. **回包 / `tool_search_call` 对象保持对象**

```json
{"type":"response.output_item.done","item":{"type":"tool_search_call","call_id":"call_1","arguments":{"query":"shell","limit":10}}}
```

规范化后 `item.arguments` 仍是 object，不是 string。

2. **回包 / `function_call` 对象仍变成 string**（防回归 `27c7b1ef`）

3. **请求 / 字符串还原成对象**

```json
{"input":[{"type":"tool_search_call","arguments":"{\"query\":\"shell\",\"limit\":10}"}]}
```

处理后 `input[0].arguments` 为 `{"query":"shell","limit":10}`。

4. **请求 / 已经是对象则不变**

5. **同 payload 里两种 type 同时存在**：`function_call` 字符串化，`tool_search_call` 保持或还原为对象。

---

## 7. 验证

1. 跑：`go test ./dto ./relay/channel/openai -count=1`
2. 本地构造一条带 `tool_search_call` 的 `/v1/responses`（arguments 故意用 string）打到修复后的 NewAPI → CPA，上游不应再 400 `invalid_type`
3. 确认普通 `function_call` 长会话、缓存、流式 usage 仍正常（`codexargs` 原需求）
4. 发版到 `23.80.82.170` 后，看 CPA `logs/error-v1-responses-*.log` 里 `got a string` 是否下降

用户侧：正在 400 的窗口先 **开新会话**；5.2 上线后旧会话才有机会自动恢复。

---

## 8. 线上对照数据（2026-08-27）

- CPA 错误日志：`/opt/cliproxyapi-deploy/logs/error-v1-responses-2026-08-27T181819-ebd3d46e.log`
- 上游响应原文与用户报错一致
- 当天 CPA `POST /v1/responses` 400：14 点 1 次，15 点 2 次，16 点 3 次，**17 点 48 次**（重试尖峰），18 点 3 次
- 10 份 `error-v1-responses-*.log` 里 8 份是 `got a string`

---

## 9. 参考

- Codex：https://github.com/openai/codex/issues/31517
- sub2api：https://github.com/Wei-Shaw/sub2api/issues/3818
- 本仓库：`dto/openai_response.go`、`dto/openai_response_arguments_test.go`、`relay/channel/openai/relay_responses.go`、`relay/responses_handler.go`
