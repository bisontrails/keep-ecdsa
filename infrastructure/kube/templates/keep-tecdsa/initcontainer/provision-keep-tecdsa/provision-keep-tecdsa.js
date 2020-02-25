const fs = require('fs');
const toml = require('toml');
const tomlify = require('tomlify-j0.4');
const concat = require('concat-stream');
const Web3 = require('web3');
const HDWalletProvider = require("@truffle/hdwallet-provider");

// ETH host info
// ETH host info
const ethRPCUrl = process.env.ETH_RPC_URL
const ethWSUrl = process.env.ETH_WS_URL
const ethNetworkId = process.env.ETH_NETWORK_ID;

// Contract owner info
var contractOwnerAddress = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;
var authorizer = contractOwnerAddress
var purse = contractOwnerAddress

var contractOwnerProvider = new HDWalletProvider(process.env.CONTRACT_OWNER_ETH_ACCOUNT_PRIVATE_KEY, ethRPCUrl);

var operatorKeyFiles = [process.env.KEEP_TECDSA_ETH_KEYFILE_1, process.env.KEEP_TECDSA_ETH_KEYFILE_2, process.env.KEEP_TECDSA_ETH_KEYFILE_3]

/*
We override transactionConfirmationBlocks and transactionBlockTimeout because they're
25 and 50 blocks respectively at default.  The result of this on small private testnets
is long wait times for scripts to execute.
*/
const web3_options = {
    defaultBlock: 'latest',
    defaultGas: 4712388,
    transactionBlockTimeout: 25,
    transactionConfirmationBlocks: 3,
    transactionPollingTimeout: 480
};

const web3 = new Web3(contractOwnerProvider, null, web3_options);

/*
Each <contract.json> file is sourced directly from the InitContainer.  Files are generated by
Truffle during contract migration and copied to the InitContainer image via Circle.
*/
const bondedECDSAKeepFactory = getWeb3Contract('BondedECDSAKeepFactory');
const keepBondingContract = getWeb3Contract('KeepBonding');
const tokenStakingContract = getWeb3Contract('TokenStaking');
const keepTokenContract = getWeb3Contract('KeepToken');

// Address of the external TBTCSystem contract which should be set for the InitContainer
// execution.
const tbtcSystemContractAddress = process.env.TBTC_SYSTEM_CONTRACT_ADDRESS;

// Returns a web3 contract object based on a truffle contract artifact JSON file.
function getWeb3Contract(contractName) {

  const filePath = `./${contractName}.json`;
  const parsed = JSON.parse(fs.readFileSync(filePath));
  const abi = parsed.abi;
  const address = parsed.networks[ethNetworkId].address;
  return new web3.eth.Contract(abi, address);
}

async function provisionKeepTecdsa() {

  try {

    console.log('###########  Provisioning keep-tecdsa! ###########');

    console.log(`\n<<<<<<<<<<<< Create Sortition Pool for TBTCSystem: ${tbtcSystemContractAddress} >>>>>>>>>>>>`);
    const sortitionPoolContractAddress = await createSortitionPool(contractOwnerAddress);

    for (let i = 0; i < operatorKeyFiles.length; i++) {
      console.log(`\n<<<<<<<<<<<< Read operator address from key file >>>>>>>>>>>>`);
      const operatorAddress = readAddressFromKeyFile(operatorKeyFiles[i])

      console.log(`\n<<<<<<<<<<<< Funding Operator Account ${operatorAddress} >>>>>>>>>>>>`);
      await fundOperator(operatorAddress, purse, '10');

      console.log(`\n<<<<<<<<<<<< Deposit to KeepBondingContract ${keepBondingContract.address} >>>>>>>>>>>>`);
      await depositUnbondedValue(operatorAddress, purse, '50');

      console.log(`\n<<<<<<<<<<<< Staking Operator Account ${operatorAddress} >>>>>>>>>>>>`);
      await stakeOperator(operatorAddress, contractOwnerAddress, authorizer);

      console.log(`\n<<<<<<<<<<<< Authorizing Operator Contract ${bondedECDSAKeepFactory.address} >>>>>>>>>>>>`);
      await authorizeOperatorContract(operatorAddress, bondedECDSAKeepFactory.address, authorizer);

      console.log(`\n<<<<<<<<<<<< Authorizing Sortition Pool Contract ${sortitionPoolContractAddress} >>>>>>>>>>>>`);
      await authorizeSortitionPoolContract(operatorAddress, sortitionPoolContractAddress, authorizer);
    }

    console.log('\n<<<<<<<<<<<< Creating keep-tecdsa Config File >>>>>>>>>>>>');
    await createKeepTecdsaConfig();

    console.log("\n########### keep-tecdsa Provisioning Complete! ###########");
    process.exit();
  }
  catch (error) {
    console.error(error.message);
    throw error;
  }
};

function readAddressFromKeyFile(keyFilePath) {
  const keyFile = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'))
  return keyFile.address
}

async function isStaked(operatorAddress) {

  console.log('Checking if operator address is staked:');
  let stakedAmount = await tokenStakingContract.methods.balanceOf(operatorAddress).call();
  return stakedAmount != 0;
};

async function isFunded(operatorAddress) {

  console.log('Checking if operator address has ether:')
  let fundedAmount = await web3.utils.fromWei(
    await web3.eth.getBalance(operatorAddress), 'ether')
  return fundedAmount >= 1;
};

async function fundOperator(operatorAddress, purse, etherToTransfer) {

  let funded = await isFunded(operatorAddress);
  let transferAmount = web3.utils.toWei(etherToTransfer, 'ether');

  if (funded === true) {
    console.log('Operator address is already funded, exiting!');
    return;
  } else {
    console.log(`Funding account ${operatorAddress} with ${etherToTransfer} ether from purse ${purse}`);
    await web3.eth.sendTransaction({from:purse, to:operatorAddress, value:transferAmount});
    console.log(`Account ${operatorAddress} funded!`);
  }
};

async function depositUnbondedValue(operatorAddress, purse, etherToDeposit) {

  let transferAmount = web3.utils.toWei(etherToDeposit, 'ether');

  await keepBondingContract.methods.deposit(
    operatorAddress,
    {value: transferAmount, from: purse})

  console.log(`deposited ${transferAmount} ETH bonding value for operatorAddress ${operatorAddress}`)
}

async function stakeOperator(operatorAddress, contractOwnerAddress, authorizer) {

  let staked = await isStaked(operatorAddress);

  /*
  We need to stake only in cases where an operator account is not already staked.  If the account
  is staked, or the client type is relay-requester we need to exit staking, albeit for different
  reasons.  In the case where the account is already staked, additional staking will fail.
  Clients of type relay-requester don't need to be staked to submit a request, they're acting more
  as a consumer of the network, rather than an operator.
  */
  if (staked === true) {
    console.log('Operator account already staked, exiting!');
    return;
  } else {
    console.log(`Staking 2000000 KEEP tokens on operator account ${operatorAddress}`);
  };

  let delegation = '0x' + Buffer.concat([
    Buffer.from(contractOwnerAddress.substr(2), 'hex'),
    Buffer.from(operatorAddress.substr(2), 'hex'),
    Buffer.from(authorizer.substr(2), 'hex')
  ]).toString('hex');

  await keepTokenContract.methods.approveAndCall(
    tokenStakingContract.address,
    formatAmount(20000000, 18),
    delegation).send({from: contractOwnerAddress})

  console.log(`Staked!`);
};

async function authorizeOperatorContract(operatorAddress, operatorContractAddress, authorizer) {

  console.log(`Authorizing Operator Contract ${operatorContractAddress} for operator account ${operatorAddress}`);

  await tokenStakingContract.methods.authorizeOperatorContract(operatorAddress, operatorContractAddress)
    .send({ from: authorizer })

  console.log(`Authorized!`);
};

async function authorizeSortitionPoolContract(operatorAddress, authorizer) {

  console.log(`Authorizing Sortition Pool Contract ${sortitionPoolContractAddress} for operator account ${operatorAddress}`);

  await keepBondingContract.methods.authorizeSortitionPoolContract(
    operatorAddress,
    sortitionPoolContractAddress)

  console.log(`Authorized!`);
};

async function createSortitionPool(contractOwnerAddress) {

  let sortitionPoolContractAddress

  try {
    sortitionPoolContractAddress = await bondedECDSAKeepFactory.methods.getSortitionPool(tbtcSystemContractAddress).call();
    console.log(`sortition pool already exists for application: [${tbtcSystemContractAddress}]`)
  } catch (err) {
    if (err.message.includes('No pool found for the application')) {
      await bondedECDSAKeepFactory.methods.createSortitionPool(tbtcSystemContractAddress).send({ from: contractOwnerAddress });

      console.log(`created sortition pool for application: [${tbtcSystemContractAddress}]`);

      sortitionPoolContractAddress = await bondedECDSAKeepFactory.methods.getSortitionPool(tbtcSystemContractAddress).call();
    } else {
      console.error("unexpected error", err)
      process.exit(1)
    }
  }

  console.log(`sortition pool contract address: ${sortitionPoolContractAddress}`);
  return sortitionPoolContractAddress
};

async function createKeepTecdsaConfig() {

  let parsedConfigFile = toml.parse(fs.readFileSync('./keep-tecdsa-config-template.toml', 'utf8'));

    parsedConfigFile.ethereum.URL = ethWSUrl;

    parsedConfigFile.ethereum.account.KeyFile = [operatorAddresses]

    parsedConfigFile.ethereum.ContractAddresses.BondedECDSAKeepFactory = bondedECDSAKeepFactoryContractAddress;

    parsedConfigFile.SanctionedApplications.Addresses = [tbtcSystemContractAddress]

    parsedConfigFile.Storage.DataDir = process.env.KEEP_DATA_DIR;

    let formattedConfigFile = tomlify.toToml(parsedConfigFile)

    fs.writeFileSync('./keep-tecdsa-config.toml', formattedConfigFile)
    console.log('keep-tecdsa config written to /mnt/keep-tecdsa/config/keep-tecdsa-config.toml');
};

/*
\heimdall aliens numbers.  Really though, the approveAndCall function expects numbers
in a particular format, this function facilitates that.
*/
function formatAmount(amount, decimals) {
  return '0x' + web3.utils.toBN(amount).mul(web3.utils.toBN(10).pow(web3.utils.toBN(decimals))).toString('hex');
};


provisionKeepTecdsa().catch(error => {
  console.error(error);
  process.exit(1);
});
