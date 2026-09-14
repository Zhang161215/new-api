package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOrderSubscriptionsForConsume_SoonestResetFirst(t *testing.T) {
	later := UserSubscription{Id: 1, UpgradeGroup: "Codex_GPT_PRO", NextResetTime: 2_000, EndTime: 9_000}
	sooner := UserSubscription{Id: 2, UpgradeGroup: "Codex_GPT_PRO", NextResetTime: 1_000, EndTime: 9_000}

	got := orderSubscriptionsForConsume([]UserSubscription{later, sooner}, "Codex_GPT_PRO", 0)
	require.Equal(t, []int{2, 1}, idsOf(got), "今天重置的 B 应排在五天后重置的 A 前面")
}

func TestOrderSubscriptionsForConsume_GroupMatchBeatsReset(t *testing.T) {
	claudeSoon := UserSubscription{Id: 1, UpgradeGroup: "Claude_Aws", NextResetTime: 100, EndTime: 9_000}
	gptLater := UserSubscription{Id: 2, UpgradeGroup: "Codex_GPT_PRO", NextResetTime: 9_000, EndTime: 9_000}

	got := orderSubscriptionsForConsume([]UserSubscription{claudeSoon, gptLater}, "Codex_GPT_PRO", 0)
	require.Equal(t, []int{2, 1}, idsOf(got), "对得上请求分组的订阅仍应优先，即使另一张更早重置")
}

func TestOrderSubscriptionsForConsume_PreferredWithinGroup(t *testing.T) {
	a := UserSubscription{Id: 1, UpgradeGroup: "Codex_GPT_PRO", NextResetTime: 1_000, EndTime: 9_000}
	b := UserSubscription{Id: 2, UpgradeGroup: "Codex_GPT_PRO", NextResetTime: 2_000, EndTime: 9_000}
	claude := UserSubscription{Id: 3, UpgradeGroup: "Claude_Aws", NextResetTime: 50, EndTime: 9_000}

	got := orderSubscriptionsForConsume([]UserSubscription{a, b, claude}, "Codex_GPT_PRO", 2)
	require.Equal(t, []int{2, 1, 3}, idsOf(got), "指定优先只在同分组档内提前，不能压过分组匹配")
}

func TestOrderSubscriptionsForConsume_NeverResetLast(t *testing.T) {
	noReset := UserSubscription{Id: 1, UpgradeGroup: "g", NextResetTime: 0, EndTime: 1_000}
	weekly := UserSubscription{Id: 2, UpgradeGroup: "g", NextResetTime: 8_000, EndTime: 9_000}

	got := orderSubscriptionsForConsume([]UserSubscription{noReset, weekly}, "g", 0)
	require.Equal(t, []int{2, 1}, idsOf(got), "不重置的订阅应排在有重置周期的后面")
}

func idsOf(subs []UserSubscription) []int {
	out := make([]int, len(subs))
	for i, s := range subs {
		out[i] = s.Id
	}
	return out
}
