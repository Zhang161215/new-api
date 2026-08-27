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
