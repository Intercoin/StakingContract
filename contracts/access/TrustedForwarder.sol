// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (access/Ownable.sol)

pragma solidity 0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ITrustedForwarder.sol";

abstract contract TrustedForwarder is Ownable, ITrustedForwarder {

    address private _trustedForwarder;


    constructor() 
        Ownable()
    {
        _trustedForwarder = address(0);
    }


    /**
    * @dev setup trusted forwarder address
    * @param forwarder trustedforwarder's address to set
    * @custom:shortd setup trusted forwarder
    * @custom:calledby owner
    */
    function setTrustedForwarder(
        address forwarder
    ) 
        public 
        onlyOwner 

    {
        require(owner() != forwarder, "FORWARDER_CAN_NOT_BE_OWNER");
        _setTrustedForwarder(forwarder);
    }
        
    /**
    * @dev checking if forwarder is trusted
    * @param forwarder trustedforwarder's address to check
    * @custom:shortd checking if forwarder is trusted
    */
    function isTrustedForwarder(
        address forwarder
    ) 
        external
        view 
        override
        returns(bool) 
    {
        return _isTrustedForwarder(forwarder);
    }

    /**
    * @dev implemented EIP-2771
    */
    function _msgSender(
    ) 
        internal 
        virtual
        override
        view 
        returns (address signer) 
    {
        signer = msg.sender;
        if (msg.data.length>=20 && _isTrustedForwarder(signer)) {
            assembly {
                signer := shr(96,calldataload(sub(calldatasize(),20)))
            }
        }    
    }

    function transferOwnership(
        address newOwner
    ) public 
        virtual 
        override 
        onlyOwner 
    {
        require(msg.sender != _trustedForwarder, "DENIED_FOR_FORWARDER");
        if (newOwner == _trustedForwarder) {
            _trustedForwarder = address(0);
        }
        super.transferOwnership(newOwner);
        
    }

    function _isTrustedForwarder(
        address forwarder
    ) 
        internal
        view 
        returns(bool) 
    {
        return forwarder == _trustedForwarder;
    }

    function _setTrustedForwarder(
        address forwarder
    ) 
        internal
    {
        _trustedForwarder = forwarder;
    }

  

}
