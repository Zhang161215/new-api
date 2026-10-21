package ratio_setting

import "testing"

func TestFormatMatchingModelName_ClaudeDottedVersion(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"claude-opus-5.5":                 "claude-opus-5-5",
		"claude-sonnet-5.5":               "claude-sonnet-5-5",
		"claude-haiku-4.5":                "claude-haiku-4-5",
		"claude-opus-5-5":                 "claude-opus-5-5",
		"claude-sonnet-5":                 "claude-sonnet-5",
		"claude-3.5-sonnet":               "claude-3-5-sonnet",
		"claude-opus-5.5-thinking":        "claude-opus-5-5-thinking",
		"claude-sonnet-4.5-20250929":      "claude-sonnet-4-5-20250929",
		"gpt-6.1-sol":                     "gpt-6.1-sol",
		"gpt-5.6-sol":                     "gpt-5.6-sol",
		"gemini-2.5-flash":                "gemini-2.5-flash",
		"claude-opus-5.5-openai-compact":  "claude-opus-5-5",
	}
	for in, want := range cases {
		got := FormatMatchingModelName(in)
		if got != want {
			t.Errorf("FormatMatchingModelName(%q)=%q, want %q", in, got, want)
		}
	}
}
