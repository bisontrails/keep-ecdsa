package tss

import (
	"fmt"
	"math/big"
	"sync"
	"testing"

	tssLib "github.com/binance-chain/tss-lib/tss"
	"github.com/ethereum/go-ethereum/crypto/secp256k1"
	"github.com/ipfs/go-log"
	"github.com/keep-network/keep-tecdsa/internal/testdata"
)

func TestGenerateSigner(t *testing.T) {
	groupSize := 5
	threshold := groupSize

	err := log.SetLogLevel("*", "INFO")
	if err != nil {
		logger.Infof("logger initialization failed: [%v]", err)
	}

	groupMembersKeys := []*big.Int{}

	for i := 0; i < groupSize; i++ {
		groupMembersKeys = append(groupMembersKeys, big.NewInt(int64(100+i)))
	}

	errChan := make(chan error)
	network := newTestNetwork(errChan)

	go func() {
		for {
			select {
			case err := <-errChan:
				t.Fatalf("unexpected error: [%v]", err)
			}
		}
	}()

	testData, err := testdata.LoadKeygenTestFixtures(groupSize)
	if err != nil {
		t.Fatalf("failed to load test data: [%v]", err)
	}

	var resultWait sync.WaitGroup
	resultWait.Add(len(groupMembersKeys))
	signers := []*Signer{}

	for i, memberKey := range groupMembersKeys {
		go func(thisMemberKey *big.Int) {
			networkChannel := network.newTestChannel()

			preParams := testData[i].LocalPreParams

			network.register(string(thisMemberKey.Bytes()), networkChannel)

			signer, err := NewSigner(
				thisMemberKey,
				groupMembersKeys,
				threshold,
				&preParams,
				networkChannel,
			)
			if err != nil {
				errChan <- fmt.Errorf("failed to generate signer: [%v]", err)
			}

			signers = append(signers, signer)

			resultWait.Done()
		}(memberKey)
	}

	resultWait.Wait()

	if len(signers) != len(groupMembersKeys) {
		t.Errorf(
			"unexpected number of signers\nexpected: %d\nactual:   %d\n",
			len(groupMembersKeys),
			len(signers),
		)
	}

	firstPublicKey := signers[0].PublicKey()
	curve := secp256k1.S256()

	if !curve.IsOnCurve(firstPublicKey.X, firstPublicKey.Y) {
		t.Error("public key is not on curve")
	}

	for i, signer := range signers {
		publicKey := signer.PublicKey()
		if publicKey.X.Cmp(firstPublicKey.X) != 0 || publicKey.Y.Cmp(firstPublicKey.Y) != 0 {
			t.Errorf("public key for party [%v] doesn't match expected", i)
		}
	}
}

func newTestNetwork(errChan chan error) *testNetwork {
	return &testNetwork{
		channels: &sync.Map{},
		errChan:  errChan,
	}
}

type testNetwork struct {
	channels *sync.Map
	errChan  chan error
}

func (c *testNetwork) newTestChannel() *testChannel {
	return &testChannel{
		network: c,
	}
}

func (c *testNetwork) register(name string, channel *testChannel) {
	c.channels.Store(name, channel)
}

type testChannel struct {
	network *testNetwork
	handler func(msg tssLib.Message) error
}

func (c *testChannel) Send(message tssLib.Message) error {
	c.network.deliver(message)
	return nil
}

func (c *testChannel) Receive(handler func(msg tssLib.Message) error) {
	c.handler = handler
}

func (c *testNetwork) deliver(message tssLib.Message) {
	from := message.GetFrom()
	to := message.GetTo()

	c.channels.Range(func(key, value interface{}) bool {
		if string(from.Key) == key {
			return true // don't self-delvier messages
		}

		channel := value.(*testChannel)

		if to == nil { // broadcast
			go func() {
				if err := channel.handler(message); err != nil {
					c.errChan <- fmt.Errorf("failed to deliver broadcasted message: %v", err)
				}
			}()

			return true
		}

		for _, destination := range to { // unicast
			if string(destination.Key) == key {
				go func() {
					if err := channel.handler(message); err != nil {
						c.errChan <- fmt.Errorf("failed to deliver unicasted message: %v", err)
					}
				}()
				return true
			}
		}

		return true
	})
}
