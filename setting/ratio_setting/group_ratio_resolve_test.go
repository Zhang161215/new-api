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

func TestCoveringSubscriptionGroup(t *testing.T) {
	require.NoError(t, UpdateGroupGroupRatioByJSONString(
		`{"Codex_GPT_PRO":{"Codex_GPT_PRO":1,"Codex_GPT_BPS[不降智]":1},"Codex_GPT_BPS[不降智]":{"Codex_GPT_BPS[不降智]":1}}`))
	t.Cleanup(func() {
		_ = UpdateGroupGroupRatioByJSONString(`{}`)
	})
	const bps = "Codex_GPT_BPS[不降智]"

	t.Run("精确匹配 upgrade_group", func(t *testing.T) {
		g, ok := CoveringSubscriptionGroup("Codex_GPT_PRO", map[string]bool{"Codex_GPT_PRO": true})
		assert.True(t, ok)
		assert.Equal(t, "Codex_GPT_PRO", g)
	})
	t.Run("周卡别名覆盖不降智分组", func(t *testing.T) {
		g, ok := CoveringSubscriptionGroup(bps, map[string]bool{"Codex_GPT_PRO": true})
		assert.True(t, ok)
		assert.Equal(t, "Codex_GPT_PRO", g)
		assert.True(t, UsingGroupCoveredByActiveSubs(bps, map[string]bool{"Codex_GPT_PRO": true}))
	})
	t.Run("未配置别名的跨组不覆盖", func(t *testing.T) {
		_, ok := CoveringSubscriptionGroup("Claude_Aws", map[string]bool{"Codex_GPT_PRO": true})
		assert.False(t, ok)
		assert.False(t, UsingGroupCoveredByActiveSubs("Claude_Aws", map[string]bool{"Codex_GPT_PRO": true}))
	})
	t.Run("无订阅不覆盖", func(t *testing.T) {
		_, ok := CoveringSubscriptionGroup(bps, nil)
		assert.False(t, ok)
	})
}
