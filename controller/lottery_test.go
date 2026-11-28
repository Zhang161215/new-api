package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestUserFacingPrizesIncludesOddsAndHidesSensitiveFields(t *testing.T) {
	prizes := []model.LotteryPrize{
		{Id: 1, Code: "q10", Label: "$10.00", Weight: 1, QuotaAmount: 10, Enabled: true, Stock: 5, RedemptionName: "r10"},
		{Id: 2, Code: "q1", Label: "$1.00", Weight: 19, QuotaAmount: 1, Enabled: true, Stock: 40, RedemptionName: "r1"},
		{Id: 3, Code: "thanks", Label: "谢谢参与", Weight: 80, QuotaAmount: 0, Enabled: true, Stock: 0},
		{Id: 4, Code: "disabled", Label: "已禁用", Weight: 50, QuotaAmount: 5, Enabled: false, Stock: 9},
	}

	got := userFacingPrizes(prizes)
	if len(got) != 3 {
		t.Fatalf("expected 3 enabled prizes, got %d", len(got))
	}

	wantOdds := []float64{1, 19, 80}
	for i, item := range got {
		if odds, ok := item["odds"].(float64); !ok || odds != wantOdds[i] {
			t.Errorf("prize[%d] odds = %#v, want %v", i, item["odds"], wantOdds[i])
		}
		for _, forbidden := range []string{"stock", "weight", "redemption_name", "redemptionName", "db_id"} {
			if _, exists := item[forbidden]; exists {
				t.Errorf("prize[%d] unexpectedly exposes %q", i, forbidden)
			}
		}
	}
}
