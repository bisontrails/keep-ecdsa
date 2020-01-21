pragma solidity ^0.5.4;

import "./ECDSAKeep.sol";
import "./api/IECDSAKeepFactory.sol";
import "./utils/AddressArrayUtils.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "@keep-network/sortition-pools/contracts/SortitionPool.sol";
import "@keep-network/sortition-pools/contracts/proxy/SortitionPoolFactory.sol";

/// @title ECDSA Keep Factory
/// @notice Contract creating bonded ECDSA keeps.
contract ECDSAKeepFactory is IECDSAKeepFactory { // TODO: Rename to BondedECDSAKeepFactory
    using AddressArrayUtils for address payable[];
    using SafeMath for uint256;

    // Notification that a new keep has been created.
    event ECDSAKeepCreated(
        address keepAddress,
        address payable[] members,
        address application
    );

    mapping(address => address) signerPools; // aplication -> signer pool

    bytes32 groupSelectionSeed;

    address sortitionPoolFactoryAddress;

    constructor(address sortitionPoolFactory) public {
        sortitionPoolFactoryAddress = sortitionPoolFactory;
    }

    /// @notice Register caller as a candidate to be selected as keep member
    /// for the provided customer application
    /// @dev If caller is already registered it returns without any changes.
    function registerMemberCandidate(address _application) external {
        if (signerPools[_application] == address(0)) {
            // This is the first time someone registers as signer for this
            // application so let's create a signer pool for it.
            signerPools[_application] = SortitionPoolFactory(sortitionPoolFactoryAddress)
                .createSortitionPool();
        }

        SortitionPool signerPool = SortitionPool(signerPools[_application]);
        signerPool.insertOperator(msg.sender, 500); // TODO: take weight from staking contract
    }

    /// @notice Open a new ECDSA keep.
    /// @dev Selects a list of members for the keep based on provided parameters.
    /// A caller of this function is expected to be an application for which
    /// member candidates were registered in a pool.
    /// @param _groupSize Number of members in the keep.
    /// @param _honestThreshold Minimum number of honest keep members.
    /// @param _owner Address of the keep owner.
    /// @return Created keep address.
    function openKeep(
        uint256 _groupSize,
        uint256 _honestThreshold,
        address _owner
    ) external payable returns (address keepAddress) {
        address application = msg.sender;
        address pool = signerPools[application];
        require(pool != address(0), "No signer pool for this application");

        address[] memory selected = SortitionPool(pool).selectGroup(
            _groupSize,
            groupSelectionSeed
        );

        address payable[] memory members = new address payable[](_groupSize);
        for (uint i = 0; i < _groupSize; i++) {
          // TODO: for each selected member, validate staking weight and create,
          // bond. If validation failed or bond could not be created, remove
          // operator from pool and try again.
          members[i] = address(uint160(selected[i]));
        }

        ECDSAKeep keep = new ECDSAKeep(
            _owner,
            members,
            _honestThreshold
        );

        keepAddress = address(keep);

        emit ECDSAKeepCreated(keepAddress, members, _application);

        // TODO: as beacon for new entry and update groupSelectionSeed in callback
    }
}
