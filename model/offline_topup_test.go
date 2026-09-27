package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCreateOfflineTopUpValidate(t *testing.T) {
	_, _, err := CreateOfflineTopUp(0, 10, "offline", true)
	require.EqualError(t, err, "请选择用户")

	_, _, err = CreateOfflineTopUp(1, 0, "offline", true)
	require.EqualError(t, err, "金额必须大于 0.01")
}
