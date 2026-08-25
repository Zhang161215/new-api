package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveSpecialGroupRatio(t *testing.T) {
	require.NoError(t, UpdateGroupRatioByJSONString(
		`{"default":0,"Codex_GPT_PRO":0.3,"Claude_Aws":0.1}`))
	require.NoError(t, UpdateGroupGroupRatioByJSONString(
		`{"Codex_GPT_PRO":{"Codex_GPT_PRO":1},"Claude_Aws":{"Claude_Aws":0.5}}`))
	t.Cleanup(func() {
		_ = UpdateGroupGroupRatioByJSONString(`{}`)
	})

	t.Run("同组订阅用户", func(t *testing.T) {
		r, ok := ResolveSpecialGroupRatio("Codex_GPT_PRO", "Codex_GPT_PRO", false)
		assert.True(t, ok)
		assert.Equal(t, float64(1), r)
	})
	t.Run("跨组无覆盖不得套 1x", func(t *testing.T) {
		r, ok := ResolveSpecialGroupRatio("Codex_GPT_PRO", "Claude_Aws", false)
		assert.False(t, ok)
		assert.Equal(t, float64(-1), r)
	})
	t.Run("叠卡：账号组被覆盖但仍持有令牌组订阅", func(t *testing.T) {
		r, ok := ResolveSpecialGroupRatio("Claude_Aws", "Codex_GPT_PRO", true)
		assert.True(t, ok)
		assert.Equal(t, float64(1), r)
	})
	t.Run("叠卡反向：账号在 GPT 组、令牌是 Claude 且有 Claude 订阅", func(t *testing.T) {
		r, ok := ResolveSpecialGroupRatio("Codex_GPT_PRO", "Claude_Aws", true)
		assert.True(t, ok)
		assert.Equal(t, 0.5, r)
	})
	t.Run("无订阅不得靠 covered=false 拿到专属倍率", func(t *testing.T) {
		r, ok := ResolveSpecialGroupRatio("default", "Codex_GPT_PRO", false)
		assert.False(t, ok)
		assert.Equal(t, float64(-1), r)
	})
}
