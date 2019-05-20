package eth

import (
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

// MemberID is unique keep member identifier.
// TODO: Consider changing to different type e.g. address.
type MemberID = big.Int

// ECDSAKeepRequestedEvent is an event emitted on a new keep creation request.
type ECDSAKeepRequestedEvent struct {
	KeepAddress common.Address // keep contract address
}
