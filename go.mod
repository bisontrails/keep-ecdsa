module github.com/keep-network/keep-tecdsa

replace (
	github.com/BurntSushi/toml => github.com/keep-network/toml v0.3.0
	github.com/blockcypher/gobcy => github.com/keep-network/gobcy v1.3.1
	github.com/btcsuite/btcd => github.com/keep-network/btcd v0.0.0-20190427004231-96897255fd17
	github.com/btcsuite/btcutil => github.com/keep-network/btcutil v0.0.0-20190425235716-9e5f4b9a998d
	github.com/ethereum/go-ethereum => github.com/keep-network/go-ethereum v1.8.15
	github.com/urfave/cli => github.com/keep-network/cli v1.20.0
)

require (
	github.com/BurntSushi/toml v0.0.0-00010101000000-000000000000
	github.com/blockcypher/gobcy v0.0.0-00010101000000-000000000000
	github.com/btcsuite/btcd v0.0.0-00010101000000-000000000000 // indirect
	github.com/ethereum/go-ethereum v0.0.0-00010101000000-000000000000
	github.com/keep-network/go-electrum v0.0.0-20190423065222-2dcd82312dcf
	github.com/urfave/cli v0.0.0-00010101000000-000000000000
)
