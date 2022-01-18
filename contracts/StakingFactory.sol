// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./interfaces/IHook.sol";
import "./interfaces/IStakingFactory.sol";
import "./interfaces/IStakingContract.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "./lib/PackedMapping32.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
//import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC777/IERC777Recipient.sol";
import "@openzeppelin/contracts/token/ERC777/ERC777.sol";
//import "hardhat/console.sol";
import "./minimums/common/MinimumsBase.sol";
//import "./StakingContract.sol";

contract StakingFactory is IStakingFactory, Ownable,  AccessControlEnumerable, ERC777, MinimumsBase, IERC777Recipient {
    using Clones for address;
    using PackedMapping32 for PackedMapping32.Map;
    //using EnumerableSet for EnumerableSet.AddressSet;

    /**
    * strategy ENUM VARS used in calculation algos
    */
    enum Strategy{ UNSTAKE, REDEEM, REDEEM_AND_REMOVE_LIQUIDITY } 
    
    uint32 internal constant LOCKUP_INTERVAL = 24*60*60; // day in seconds
    uint64 internal constant FRACTION = 100000; // fractions are expressed as portions of this

    bytes32 public constant ADMIN_ROLE = "admin";
    bytes32 public constant REDEEM_ROLE = "redeem";

    address public implementation;
    IHook public hook; // hook used to bonus calculation
    uint256 public immutable discountSensitivity;

    uint256 totalUnstakeable;
    uint256 totalRedeemable;
    uint256 totalExtra;         // extra tokens minted by factory when staked

    mapping(address => mapping(
        address => mapping(
            uint256 => address
        )
    )) public override getInstance;

    address[] public override instances;
    mapping(address => uint256) private _instanceIndexes;
    mapping(address => address) private _instanceCreators;

    // staked balance in instances. increase when stakes, descrease when unstake/redeem
    mapping(address => uint256) private _instanceStaked;
    
    struct InstanceInfo {
        address reserveToken;
        uint64 duration;
        address tradedToken;
        uint64 reserveTokenClaimFraction;
        uint64 tradedTokenClaimFraction;
        uint64 lpClaimFraction;
        bool exists;
    }
    mapping(address => InstanceInfo) private _instanceInfos;

    ////////////////////
    
    //bytes32 private constant TOKENS_SENDER_INTERFACE_HASH = keccak256("ERC777TokensSender");
    bytes32 private constant TOKENS_RECIPIENT_INTERFACE_HASH = keccak256("ERC777TokensRecipient");

    //EnumerableSet.AddressSet private rewardTokensList;
    mapping(address => uint256) public rewardTokenRatios;
    mapping(address => uint256) public unstakeable;


    event RewardGranted(address indexed token, address indexed account, uint256 amount);
    event Staked(address indexed account, uint256 amount, uint256 priceBeforeStake);
    event Redeemed(address indexed account, uint256 amount);

    modifier onlyStaking() {
        require(_instanceInfos[msg.sender].exists == true);
        _;
    }

    constructor(
        address impl,
        address hook_,
        uint256 discountSensitivity_
    ) 
        ERC777("Staking Tokens", "STAKE", (new address[](0)))
        MinimumsBase(LOCKUP_INTERVAL)
    {
        implementation = impl;
//        implementation = address(new StakingContract());!!!!!!!
        hook = IHook(hook_);

        discountSensitivity = discountSensitivity_;
        
        _grantRole(ADMIN_ROLE, msg.sender);
        _setRoleAdmin(REDEEM_ROLE, ADMIN_ROLE);

    }

    ////////////////////////////////////////////////////////////////////////
    // external section ////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////
    function instancesCount()
        external 
        override 
        view 
        returns (uint) 
    {
        return instances.length;
    }

    function issueWalletTokens(
        address account, 
        uint256 amount, 
        uint256 priceBeforeStake
    ) 
        external 
        override
        onlyStaking
    {
        //_issueWalletTokens(msg.sender, account, amount, duration, priceBeforeStake);
        //_addToRatioBalance(_instanceIndexes[msg.sender], account, amount);

        address instance = msg.sender;
        _instanceStaked[instance] += amount;

        // logic "how much bonus user will obtain"
        uint256 bonusAmount = 0; 
        if (address(hook) != address(0)) {
            bonusAmount = hook.bonusCalculation(instance, account, _instanceInfos[instance].duration, amount);
        }

        totalExtra += bonusAmount;
        
        unstakeable[account] += amount;
        totalUnstakeable += amount;
        
        // means extra tokens should not to include into unstakeable and totalUnstakeable, but part of them will be increase totalRedeemable
        // also keep in mind that user can unstake only unstakeable[account] which saved w/o bonusTokens, but minimums and mint with it.
        // it's provide to use such tokens like transfer but prevent unstake bonus in 1to1 after minimums expiring
        amount += bonusAmount;

        _mint(account, amount, "", "");
        emit Staked(account, amount, priceBeforeStake);
        _minimumsAdd(account, amount, _instanceInfos[instance].duration, false);

    }

    /**
    * @notice used to catch when used try to redeem by sending shares directly to contract
    * see more in {IERC777RecipientUpgradeable::tokensReceived}
    */
    function tokensReceived(
        address /*operator*/,
        address from,
        address to,
        uint256 amount,
        bytes calldata /*userData*/,
        bytes calldata /*operatorData*/
    ) 
        external 
        override
    {
        if (_msgSender() == address(this) && to == address(this)) {
            _redeem(from, amount, new address[](0));
        }
    }


    ////////////////////////////////////////////////////////////////////////
    // public section //////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////
    function produce(
        address reserveToken, 
        address tradedToken, 
        uint64 duration
    ) public returns (address instance) {
         // 1% from LP tokens should move to owner while user try to redeem
        return _produce(reserveToken, tradedToken, duration, 0, 0, 1000);
    }
    
    function produce(
        address reserveToken, 
        address tradedToken, 
        uint64 duration, 
        uint64 reserveTokenClaimFraction, 
        uint64 tradedTokenClaimFraction, 
        uint64 lpClaimFraction
    ) public onlyOwner() returns (address instance) {
        return _produce(reserveToken, tradedToken, duration, reserveTokenClaimFraction, tradedTokenClaimFraction, lpClaimFraction);
    }
    
    function getInstanceInfo(
        address reserveToken, 
        address tradedToken, 
        uint64 duration
    ) public view returns(InstanceInfo memory) {
        address instance = getInstance[reserveToken][tradedToken][duration];
        return _instanceInfos[instance];
    }

    /**
    * @notice method like redeem but can applicable only for own staked tokens. so no need to have redeem role for this
    */
    function unstake(
        uint256 amount
    ) 
        public 
    {
        address account = msg.sender;

        uint256 locked = _getMinimum(account);
        uint256 remainingAmount = balanceOf(account) - amount;
        require(locked <= remainingAmount, "STAKE_NOT_UNLOCKED_YET");
        

        //uint256 totalSharesBalanceBefore = _beforeRedeem(account, amount);
        _beforeRedeem(account, amount);

        (address[] memory instancesList, uint256[] memory values) = _poolStakesAvailable(account, amount, new address[](0), Strategy.UNSTAKE);
        for (uint256 i = 0; i < instancesList.length; i++) {
            try IStakingContract(instancesList[i]).redeem(
                account, 
                values[i]
            ) {
                _instanceStaked[instancesList[i]] -= values[i];
            }
            catch {
                revert("Error when unstake");
            }
        }
    }
    
    function redeem(
        uint256 amount
    ) 
        public
    {
        _redeem(msg.sender, amount, new address[](0));
    }

    /**
    * @notice way to redeem via approve/transferFrom. Another way is send directly to contract. User will obtain uniswap-LP tokens
    * @param amount The number of shares that will be redeemed.
    * @param preferredInstances preferred instances for redeem first
    */
    function redeem(
        uint256 amount,
        address[] memory preferredInstances
    ) 
        public
    {
        _redeem(msg.sender, amount, preferredInstances);
    }

    /**
    * @notice way to redeem and remove liquidity via approve/transferFrom shares. User will obtain reserve and traded tokens back
    * @param amount The number of shares that will be redeemed.
    */
    function redeemAndRemoveLiquidity(
        uint256 amount
    ) 
        public
    {
        _redeemAndRemoveLiquidity(msg.sender, amount, new address[](0));
    }

    /**
    * @notice way to redeem and remove liquidity via approve/transferFrom shares. User will obtain reserve and traded tokens back
    * @param amount The number of shares that will be redeemed.
    * @param preferredInstances preferred instances for redeem first
    */
    function redeemAndRemoveLiquidity(
        uint256 amount,
        address[] memory preferredInstances
    ) 
        public
    {
        _redeemAndRemoveLiquidity(msg.sender, amount, preferredInstances);
    }

     
    function viewLockedWalletTokens(
        address account
    ) 
        public 
        view 
        returns (uint256 amount) 
    {
        amount = _getMinimum(account);
    }   
    ////////////////////////////////////////////////////////////////////////
    // internal section ////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////
    

    function _produce(
        address reserveToken,
        address tradedToken,
        uint64 duration,
        uint64 reserveTokenClaimFraction,
        uint64 tradedTokenClaimFraction,
        uint64 lpClaimFraction
    ) internal returns (address instance) {
        _createInstanceValidate(
            reserveToken, tradedToken, duration, 
            reserveTokenClaimFraction, tradedTokenClaimFraction
        );

        address instanceCreated = _createInstance(reserveToken, tradedToken, duration, reserveTokenClaimFraction, tradedTokenClaimFraction, lpClaimFraction);    

        require(instanceCreated != address(0), "StakingFactory: INSTANCE_CREATION_FAILED");
        require(duration != 0, "cant be zero duration");
        // if (duration == 0) {
        //     IStakingTransferRules(instanceCreated).initialize(
        //         reserveToken,  tradedToken, reserveTokenClaimFraction, tradedTokenClaimFraction, lpClaimFraction
        //     );
        // } else {
            IStakingContract(instanceCreated).initialize(
                reserveToken,  tradedToken, reserveTokenClaimFraction, tradedTokenClaimFraction, lpClaimFraction
            );
        // }
        
        //Ownable(instanceCreated).transferOwnership(_msgSender());
        instance = instanceCreated;        
    }
    
    function _createInstanceValidate(
        address reserveToken, 
        address tradedToken, 
        uint64 duration, 
        uint64 tradedClaimFraction, 
        uint64 reserveClaimFraction
    ) internal view {
        require(reserveToken != tradedToken, "StakingFactory: IDENTICAL_ADDRESSES");
        require(reserveToken != address(0) && tradedToken != address(0), "StakingFactory: ZERO_ADDRESS");
        require(tradedClaimFraction <= FRACTION && reserveClaimFraction <= FRACTION, "StakingFactory: WRONG_CLAIM_FRACTION");
        address instance = getInstance[reserveToken][tradedToken][duration];
        require(instance == address(0), "StakingFactory: PAIR_ALREADY_EXISTS");
    }
        
    function _createInstance(
        address reserveToken, 
        address tradedToken, 
        uint64 duration, 
        uint64 reserveTokenClaimFraction, 
        uint64 tradedTokenClaimFraction, 
        uint64 lpClaimFraction
    ) internal returns (address instance) {

        instance = implementation.clone();
        
        getInstance[reserveToken][tradedToken][duration] = instance;
        
        _instanceIndexes[instance] = instances.length;
        instances.push(instance);

        _instanceCreators[instance] = msg.sender;
        _instanceInfos[instance] = InstanceInfo(
            reserveToken,
            duration, 
            tradedToken,
            reserveTokenClaimFraction,
            tradedTokenClaimFraction,
            lpClaimFraction,
            true
        );
        emit InstanceCreated(reserveToken, tradedToken, instance, instances.length);
    }

    function _beforeRedeem(
        address account,
        uint256 amount
    ) 
        internal 
       // returns(uint256 totalSharesBalanceBefore)
    {
        //totalSharesBalanceBefore = totalSupply();
        require(allowance(account, address(this))  >= amount, "Redeem amount exceeds allowance");
        _burn(account, amount, "", "");
    }

    // create map of instance->amount or LP tokens that need to redeem
    function _poolStakesAvailable(
        address account,
        uint256 amount,
        address[] memory preferredInstances,
        Strategy strategy
    ) 
        internal 
        view
        returns(
            address[] memory instancesAddress, 
            uint256[] memory values
        ) 
    {
        if (preferredInstances.length == 0) {
            preferredInstances = instances;
        }
        uint256 amountLeft = amount;
        uint256 amountToRedeem;
        uint256 len;

        if (
            strategy == Strategy.REDEEM || 
            strategy == Strategy.REDEEM_AND_REMOVE_LIQUIDITY 
        ) {
            
            // TODO 0: 
            // //Сколько X  LP токенов выдать пользователю при  запросе Y токенов
            // LPTokens =  WalletTokens * ratio;
            // ratio = A / (A + B * discountSensitivity);
            // где 
            // discountSensitivity - константа которая указывается в фабрике FactoryContract
            // A = totalRedeemable across all pools
            // B = totalSupply - A - totalUnstakeable
            uint256 A = totalRedeemable;
            uint256 B = totalSupply() - A - totalUnstakeable;
            uint256 ratio = A / (A + B * discountSensitivity);
            amountLeft =  amount * ratio; // LPTokens =  WalletTokens * ratio;
        } else {
            amountLeft = amount;
        }

        for (uint256 i = 0; i < preferredInstances.length; i++) {
            
            if (_instanceStaked[preferredInstances[i]] > 0) {
                if (strategy == Strategy.UNSTAKE) {
                    amountToRedeem = 
                        amountLeft > _instanceStaked[preferredInstances[i]]
                        ? 
                            _instanceStaked[preferredInstances[i]] > unstakeable[account]
                            ? 
                            unstakeable[account]
                            :
                            _instanceStaked[preferredInstances[i]]
                        : 
                        amountLeft;
                
                } else if (
                    strategy == Strategy.REDEEM || 
                    strategy == Strategy.REDEEM_AND_REMOVE_LIQUIDITY 
                ) {
                    amountToRedeem = 
                        amountLeft > _instanceStaked[preferredInstances[i]] 
                        ? 
                        _instanceStaked[preferredInstances[i]] 
                        : 
                        amountLeft
                        ;
                }
                
                if (amountToRedeem > 0) {
                    instancesAddress[len] = preferredInstances[i]; 
                    values[len] = amountToRedeem;
                    len += 1;

                    amountLeft -= amountToRedeem;
                }
            }

            
        }
        
        require(amountLeft == 0, "insufficient amount");

    }

    function _redeem(
        address account,
        uint256 amount,
        address[] memory preferredInstances
    ) 
        internal 
        onlyRole(REDEEM_ROLE)  
    {
        require (amount <= totalRedeemable, "insufficient balance to redeem");
        // uint256 totalSharesBalanceBefore = _beforeRedeem(account, amount);
        _beforeRedeem(account, amount);

        (address[] memory instancesToRedeem, uint256[] memory valuesToRedeem) = _poolStakesAvailable(account, amount, preferredInstances, Strategy.REDEEM);
        for (uint256 i = 0; i < instancesToRedeem.length; i++) {
            if (_instanceStaked[instancesToRedeem[i]] > 0) {
                try IStakingContract(instancesToRedeem[i]).redeem(
                    account, 
                    valuesToRedeem[i]
                ) {
                    _instanceStaked[instancesToRedeem[i]] -= valuesToRedeem[i];
                    totalRedeemable -= valuesToRedeem[i];
                }
                catch {
                    revert("Error when redeem in an instance");
                }
            }
        }
    }

    function _redeemAndRemoveLiquidity(
        address account,
        uint256 amount,
        address[] memory preferredInstances
    ) 
        internal 
        onlyRole(REDEEM_ROLE)  
    {
        
        require (amount <= totalRedeemable, "insufficient balance to redeem");

        //uint256 totalSharesBalanceBefore = _beforeRedeem(account, amount);
        _beforeRedeem(account, amount);

        (address[] memory instancesToRedeem, uint256[] memory valuesToRedeem) = _poolStakesAvailable(account, amount, preferredInstances, Strategy.REDEEM_AND_REMOVE_LIQUIDITY);

        for (uint256 i = 0; i < instancesToRedeem.length; i++) {
            if (_instanceStaked[instancesToRedeem[i]] > 0) {
                try IStakingContract(preferredInstances[i]).redeemAndRemoveLiquidity(
                    account, 
                    valuesToRedeem[i]
                ) {
                    _instanceStaked[instancesToRedeem[i]] -= valuesToRedeem[i];
                    totalRedeemable -= valuesToRedeem[i];
                }
                catch {
                    revert("Error when redeem");
                }
            }
        }
    }

    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256 amount
    ) 
        internal 
        virtual 
        override 
    {
        if (from !=address(0)) { // otherwise minted
            if (from == address(this) && to == address(0)) { // burnt by contract itself

            } else { 
    
                uint256 balance = balanceOf(from);

                if (balance >= amount) {
                    
                    // uint256 remainingAmount = balance - amount;

                    // if (
                    //     to == address(0) || // if burnt
                    //     to == address(this) // if send directly to contract
                    // ) {
                    //     //it's try to redeem
                    //     // if (locked > remainingAmount) {
                    //     //     revert("STAKE_NOT_UNLOCKED_YET");
                    //     // //} else {
                            
                    //     // }

                        
            
                    // } else if (locked > remainingAmount) {
                    //     // else it's just transfer
                    //     uint256 lockedAmountToTransfer = (locked - remainingAmount);
                    //     minimumsTransfer(from, to, lockedAmountToTransfer);
                    //     //?????

                    // }

                    uint256 remainingAmount = balance - amount;
                    
                    if (
                        to == address(0) || // if burnt
                        to == address(this) // if send directly to contract
                    ) {
                        require(amount <= totalRedeemable, "STAKE_NOT_UNLOCKED_YET");
                    } else {
                        // else it's just transfer
                        // unstakeable[from] means as locked var. but not equal: locked can be less than unstakeable[from]
                        
                        
                        uint256 locked = _getMinimum(from);
                        //else drop locked minimum, but remove minimums even if remaining was enough
                        //minimumsTransfer(account, ZERO_ADDRESS, (locked - remainingAmount))
                        if (locked > 0 && locked >= amount ) {
                            minimumsTransfer(from, ZERO_ADDRESS, amount);
                        }

                        uint256 r = unstakeable[from] - remainingAmount;
                        unstakeable[from] -= r;
                        totalUnstakeable -= r;
                        totalRedeemable += r;
    
                    }
                    
                } else {
                    // insufficient balance error would be in {ERC777::_move}
                }
            }
        }
        super._beforeTokenTransfer(operator, from, to, amount);

    }


}
