// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../interfaces/ITaxes.sol";
contract MockTaxes is ITaxes {
    //uint64 internal constant FRACTION = 100000; // fractions are expressed as portions of this

    bool internal hTransferFlag;
    uint256 internal hAmount;

    function setupVars(
        uint256 amount,
        bool boolFlag
    )
        public 
    {
        hTransferFlag = boolFlag;
        hAmount = amount;

    }

    function beforeTransfer(
        address /*operator*/, 
        address /*from*/, 
        address /*to*/, 
        uint256 /*amount*/
    )
        external
        //override
        returns(bool success, uint256 amountAdjusted)
    {
        return (hTransferFlag, hAmount);
    }

}