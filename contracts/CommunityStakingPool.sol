// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "./CommunityStakingPoolBase.sol";
import "./interfaces/ICommunityStakingPool.sol";

//import "hardhat/console.sol";

contract CommunityStakingPool is CommunityStakingPoolBase, ICommunityStakingPool {
    /**
     * @custom:shortd address of ERC20 token.
     * @notice address of ERC20 token. ie investor token - ITR
     */
    address public stakingToken;

    error Denied();
    ////////////////////////////////////////////////////////////////////////
    // external section ////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////

    /**
     * @notice Special function receive ether
     */
    receive() external payable {
        revert Denied();
    }

    // left when will be implemented
    // function tokensToSend(
    //     address operator,
    //     address from,
    //     address to,
    //     uint256 amount,
    //     bytes calldata userData,
    //     bytes calldata operatorData
    // )   override
    //     virtual
    //     external
    // {
    // }

    /**
     * @notice initialize method. Called once by the factory at time of deployment
     * @param stakingProducedBy_ address of Community Coin token.
     * @param stakingToken_ address of ERC20 token.
     * @param donations_ array of tuples donations. address,uint256. if array empty when coins will obtain sender, overwise donation[i].account  will obtain proportionally by ration donation[i].amount
     * @custom:shortd initialize method. Called once by the factory at time of deployment
     */
    function initialize(
        address stakingProducedBy_,
        address stakingToken_,
        IStructs.StructAddrUint256[] memory donations_,
        uint64 rewardsRateFraction_
    ) external override initializer {
        CommunityStakingPoolBase_init(
            stakingProducedBy_,
            donations_,
            rewardsRateFraction_
        );

        stakingToken = stakingToken_;
    }

    ////////////////////////////////////////////////////////////////////////
    // public section //////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////

    /**
     * @notice way to redeem via approve/transferFrom. Another way is send directly to contract.
     * @param account account address will redeemed from
     * @param amount The number of shares that will be redeemed
     * @custom:calledby staking contract
     * @custom:shortd redeem erc20 tokens
     */
    function redeem(address account, uint256 amount)
        external
        //override
        onlyStaking
        returns (uint256 affectedLPAmount, uint64 rewardsRate)
    {
        affectedLPAmount = _redeem(account, amount);
        rewardsRate = rewardsRateFraction;
    }

    function stake(uint256 tokenAmount, address beneficiary) public nonReentrant {
        address account = _msgSender();
        IERC20Upgradeable(stakingToken).transferFrom(account, address(this), tokenAmount);
        _stake(beneficiary, tokenAmount, 0);
    }

    /**
     * @param tokenAddress token that will swap to `erc20Address` token
     * @param tokenAmount amount of `tokenAddress` token
     * @param beneficiary wallet which obtain LP tokens
     * @notice method will receive `tokenAmount` of token `tokenAddress` then will swap all to `erc20address` and finally stake it. Beneficiary will obtain shares
     * @custom:shortd  the way to receive `tokenAmount` of token `tokenAddress` then will swap all to `erc20address` and finally stake it. Beneficiary will obtain shares
     */
    function buyAndStake(
        address tokenAddress,
        uint256 tokenAmount,
        address beneficiary
    ) public nonReentrant {
        IERC20Upgradeable(tokenAddress).transferFrom(_msgSender(), address(this), tokenAmount);

        address pair = IUniswapV2Factory(uniswapRouterFactory).getPair(stakingToken, tokenAddress);
        require(pair != address(0), "NO_UNISWAP_V2_PAIR");
        //uniswapV2Pair = IUniswapV2Pair(pair);

        uint256 stakingTokenAmount = doSwapOnUniswap(tokenAddress, stakingToken, tokenAmount);
        require(stakingTokenAmount != 0, "insufficient on uniswap");
        _stake(beneficiary, stakingTokenAmount, 0);
    }

    ////////////////////////////////////////////////////////////////////////
    // internal section ////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////
    function _redeem(address account, uint256 amount) internal returns (uint256 affectedLPAmount) {
        affectedLPAmount = __redeem(account, amount);
        IERC20Upgradeable(stakingToken).transfer(account, affectedLPAmount);
    }

    ////////////////////////////////////////////////////////////////////////
    // private section /////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////////////
    function __redeem(address sender, uint256 amount) private returns (uint256 amount2Redeem) {
        emit Redeemed(sender, amount);

        // validate free amount to redeem was moved to method _beforeTokenTransfer
        // transfer and burn moved to upper level
        // #dev strange way to point to burn tokens. means need to set lpFraction == 0 and lpFractionBeneficiary should not be address(0) so just setup as `producedBy`
        amount2Redeem = _fractionAmountSend(
            stakingToken,
            amount,
            0, // lpFraction,
            stakingProducedBy, //lpFractionBeneficiary == address(0) ? stakingProducedBy : lpFractionBeneficiary,
            address(0)
        );
    }
}
