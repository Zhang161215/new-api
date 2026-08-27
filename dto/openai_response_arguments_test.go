package dto

import (
	"encoding/json"
	"testing"
)

func TestFlexibleJSONString_UnmarshalObjectAndString(t *testing.T) {
	t.Parallel()

	var fromObject FlexibleJSONString
	if err := json.Unmarshal([]byte(`{"command":"ls"}`), &fromObject); err != nil {
		t.Fatalf("object unmarshal: %v", err)
	}
	if fromObject.String() != `{"command":"ls"}` {
		t.Fatalf("object stored as %q", fromObject)
	}

	var fromString FlexibleJSONString
	if err := json.Unmarshal([]byte(`"{\"command\":\"ls\"}"`), &fromString); err != nil {
		t.Fatalf("string unmarshal: %v", err)
	}
	if fromString.String() != `{"command":"ls"}` {
		t.Fatalf("string stored as %q", fromString)
	}

	var fromNull FlexibleJSONString
	if err := json.Unmarshal([]byte(`null`), &fromNull); err != nil {
		t.Fatalf("null unmarshal: %v", err)
	}
	if fromNull.String() != "" {
		t.Fatalf("null stored as %q", fromNull)
	}
}

func TestResponsesStreamResponse_AcceptsObjectArguments(t *testing.T) {
	t.Parallel()

	itemAdded := `{
		"type":"response.output_item.done",
		"item":{
			"type":"function_call",
			"id":"fc_1",
			"call_id":"call_1",
			"name":"shell",
			"arguments":{"command":"pwd"}
		}
	}`
	var added ResponsesStreamResponse
	if err := json.Unmarshal([]byte(itemAdded), &added); err != nil {
		t.Fatalf("item.done unmarshal: %v", err)
	}
	if added.Item == nil || added.Item.Arguments.String() != `{"command":"pwd"}` {
		t.Fatalf("item.arguments=%v", added.Item)
	}

	completed := `{
		"type":"response.completed",
		"response":{
			"id":"resp_1",
			"output":[{
				"type":"function_call",
				"name":"shell",
				"arguments":{"command":"pwd"}
			}],
			"usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14}
		}
	}`
	var done ResponsesStreamResponse
	if err := json.Unmarshal([]byte(completed), &done); err != nil {
		t.Fatalf("completed unmarshal: %v", err)
	}
	if done.Response == nil || done.Response.Usage == nil || done.Response.Usage.TotalTokens != 14 {
		t.Fatalf("usage not parsed: %+v", done.Response)
	}
	if len(done.Response.Output) != 1 || done.Response.Output[0].Arguments.String() != `{"command":"pwd"}` {
		t.Fatalf("output.arguments=%v", done.Response.Output)
	}
}

func TestNormalizeResponsesFunctionArguments(t *testing.T) {
	t.Parallel()

	raw := `{"type":"response.output_item.done","item":{"type":"function_call","name":"shell","arguments":{"command":"pwd"}}}`
	got := NormalizeResponsesFunctionArguments(raw)
	var parsed map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("normalized json: %v (%s)", err, got)
	}
	item, _ := parsed["item"].(map[string]any)
	args, _ := item["arguments"].(string)
	if args != `{"command":"pwd"}` {
		t.Fatalf("normalized arguments=%q in %s", args, got)
	}

	alreadyString := `{"item":{"arguments":"{\"a\":1}"}}`
	if NormalizeResponsesFunctionArguments(alreadyString) != alreadyString {
		t.Fatalf("string arguments should be left unchanged")
	}
}

func TestNormalizeKeepsToolSearchCallArgumentsObject(t *testing.T) {
	t.Parallel()

	raw := `{"type":"response.output_item.done","item":{"type":"tool_search_call","call_id":"call_1","arguments":{"query":"shell","limit":10}}}`
	got := NormalizeResponsesFunctionArguments(raw)
	item := mustNestedMap(t, got, "item")
	args, ok := item["arguments"].(map[string]any)
	if !ok {
		t.Fatalf("tool_search_call.arguments should stay object, got %T in %s", item["arguments"], got)
	}
	if args["query"] != "shell" {
		t.Fatalf("query=%v", args["query"])
	}
	limit, _ := args["limit"].(float64)
	if limit != 10 {
		t.Fatalf("limit=%v", args["limit"])
	}
}

func TestNormalizeMixedFunctionCallAndToolSearchCall(t *testing.T) {
	t.Parallel()

	raw := `{"output":[{"type":"function_call","name":"shell","arguments":{"command":"pwd"}},{"type":"tool_search_call","arguments":{"query":"shell","limit":10}}]}`
	got := NormalizeResponsesFunctionArguments(raw)
	output := mustArray(t, got, "output")
	fn, _ := output[0].(map[string]any)
	if _, ok := fn["arguments"].(string); !ok {
		t.Fatalf("function_call.arguments should become string, got %T in %s", fn["arguments"], got)
	}
	search, _ := output[1].(map[string]any)
	if _, ok := search["arguments"].(map[string]any); !ok {
		t.Fatalf("tool_search_call.arguments should stay object, got %T in %s", search["arguments"], got)
	}
}

func TestCoerceToolSearchCallArgumentsStringToObject(t *testing.T) {
	t.Parallel()

	raw := []byte(`{"input":[{"type":"tool_search_call","arguments":"{\"query\":\"shell\",\"limit\":10}"}]}`)
	got := CoerceToolSearchCallArguments(raw)
	input := mustArray(t, string(got), "input")
	item, _ := input[0].(map[string]any)
	args, ok := item["arguments"].(map[string]any)
	if !ok {
		t.Fatalf("coerced arguments should be object, got %T in %s", item["arguments"], got)
	}
	if args["query"] != "shell" {
		t.Fatalf("query=%v", args["query"])
	}
}

func TestCoerceToolSearchCallArgumentsAlreadyObject(t *testing.T) {
	t.Parallel()

	raw := []byte(`{"input":[{"type":"tool_search_call","arguments":{"query":"shell"}}]}`)
	got := CoerceToolSearchCallArguments(raw)
	if string(got) != string(raw) {
		t.Fatalf("object arguments should be left unchanged:\n got %s\nwant %s", got, raw)
	}
}

func TestCoerceLeavesFunctionCallStringAndInvalidSearchString(t *testing.T) {
	t.Parallel()

	raw := []byte(`{"input":[{"type":"function_call","arguments":"{\"command\":\"pwd\"}"},{"type":"tool_search_call","arguments":"not-json"}]}`)
	got := CoerceToolSearchCallArguments(raw)
	if string(got) != string(raw) {
		t.Fatalf("function_call string and unparseable search string should stay:\n got %s\nwant %s", got, raw)
	}
}

func TestCoerceMixedFunctionCallAndToolSearchCall(t *testing.T) {
	t.Parallel()

	raw := []byte(`{"input":[{"type":"function_call","arguments":"{\"command\":\"pwd\"}"},{"type":"tool_search_call","arguments":"{\"query\":\"shell\",\"limit\":10}"}]}`)
	got := CoerceToolSearchCallArguments(raw)
	input := mustArray(t, string(got), "input")
	fn, _ := input[0].(map[string]any)
	if _, ok := fn["arguments"].(string); !ok {
		t.Fatalf("function_call.arguments should stay string, got %T in %s", fn["arguments"], got)
	}
	search, _ := input[1].(map[string]any)
	if _, ok := search["arguments"].(map[string]any); !ok {
		t.Fatalf("tool_search_call.arguments should become object, got %T in %s", search["arguments"], got)
	}
}

func mustNestedMap(t *testing.T, raw string, keys ...string) map[string]any {
	t.Helper()
	var cur any
	if err := json.Unmarshal([]byte(raw), &cur); err != nil {
		t.Fatalf("json: %v (%s)", err, raw)
	}
	for _, key := range keys {
		m, ok := cur.(map[string]any)
		if !ok {
			t.Fatalf("expected object at %q, got %T in %s", key, cur, raw)
		}
		cur = m[key]
	}
	m, ok := cur.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %T in %s", cur, raw)
	}
	return m
}

func mustArray(t *testing.T, raw, key string) []any {
	t.Helper()
	var root map[string]any
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		t.Fatalf("json: %v (%s)", err, raw)
	}
	arr, ok := root[key].([]any)
	if !ok {
		t.Fatalf("expected array %q, got %T in %s", key, root[key], raw)
	}
	return arr
}
