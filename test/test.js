const { ethers, waffle } = require('hardhat');
const { BigNumber } = require('ethers');
const { expect } = require('chai');
const chai = require('chai');
const { time } = require('@openzeppelin/test-helpers');

const ZERO = BigNumber.from('0');
const ONE = BigNumber.from('1');
const TWO = BigNumber.from('2');
const THREE = BigNumber.from('3');
const FOUR = BigNumber.from('3');
const SEVEN = BigNumber.from('7');
const TEN = BigNumber.from('10');
const HUNDRED = BigNumber.from('100');
const THOUSAND = BigNumber.from('1000');


const ONE_ETH = ethers.utils.parseEther('1');

//const TOTALSUPPLY = ethers.utils.parseEther('1000000000');    
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const UNISWAP_ROUTER_FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

const REDEEM_ROLE = 'redeem';


function convertToHex(str) {
    var hex = '';
    for(var i=0;i<str.length;i++) {
        hex += ''+str.charCodeAt(i).toString(16);
    }
    return hex;
}
function padZeros(num, size) {
    var s = num+"";
    while (s.length < size) s =  s + "0";
    return s;
}

describe("Staking contract tests", function () {
    const accounts = waffle.provider.getWallets();
    const owner = accounts[0];                     
    const alice = accounts[1];
    const bob = accounts[2];
    const charlie = accounts[3];
    const liquidityHolder = accounts[4];
    const trustedForwarder = accounts[5];

    
    const reserveTokenClaimFraction = 0;
    const tradedTokenClaimFraction = 0;
    const lpClaimFraction = 1000;
    const numerator = 1;
    const denominator = 1;
    const dayInSeconds = 24*60*60; // * interval: DAY in seconds
    const lockupIntervalCount = 365; // year in days(dayInSeconds)
    const percentLimitLeftTokenB = 0.001;

    const wrongClaimFraction = 99999999999;
    const discountSensitivity = 0;

    var implementationCommunityCoin;
    var implementationCommunityCoinInstances;
    var implementationCommunityStakingPool;
    var mockHook;
    var CommunityCoinFactory;
    var CommunityCoin;
    var CommunityCoinWithHook;
    var erc20;
    var erc777;
    var erc20TradedToken;
    var erc20ReservedToken;
    var erc20Reward;
    
    
    beforeEach("deploying", async() => {
        const CommunityCoinFactoryF = await ethers.getContractFactory("CommunityCoinFactory");

        const CommunityCoinF = await ethers.getContractFactory("CommunityCoin");
        const CommunityStakingPoolF = await ethers.getContractFactory("CommunityStakingPool");
        const CommunityCoinInstancesF = await ethers.getContractFactory("CommunityCoinInstances");

        const MockHookF = await ethers.getContractFactory("MockHook");
        const ERC20Factory = await ethers.getContractFactory("ERC20Mintable");
        
        
        implementationCommunityCoin = await CommunityCoinF.deploy();
        implementationCommunityCoinInstances = await CommunityCoinInstancesF.deploy();
        implementationCommunityStakingPool = await CommunityStakingPoolF.deploy();
        mockHook = await MockHookF.deploy();

        
        CommunityCoinFactory  = await CommunityCoinFactoryF.deploy(implementationCommunityCoin.address, implementationCommunityCoinInstances.address, implementationCommunityStakingPool.address);

        let tx,rc,event,instance,instancesCount;
        // without hook
        tx = await CommunityCoinFactory.connect(owner).produce(ZERO_ADDRESS, discountSensitivity);
        rc = await tx.wait(); // 0ms, as tx is already confirmed
        event = rc.events.find(event => event.event === 'InstanceCreated');
        [instance, instancesCount] = event.args;
        CommunityCoin = await ethers.getContractAt("CommunityCoin",instance);

        // with hook
        tx = await CommunityCoinFactory.connect(owner).produce(mockHook.address, discountSensitivity);
        rc = await tx.wait(); // 0ms, as tx is already confirmed
        event = rc.events.find(event => event.event === 'InstanceCreated');
        [instance, instancesCount] = event.args;
        CommunityCoinWithHook = await ethers.getContractAt("CommunityCoin",instance);

        erc20 = await ERC20Factory.deploy("ERC20 Token", "ERC20");
        erc777 = await ERC20Factory.deploy("ERC777 Token", "ERC777");
        erc20TradedToken = await ERC20Factory.deploy("ERC20 Traded Token", "ERC20-TRD");
        erc20ReservedToken = await ERC20Factory.deploy("ERC20 Reserved Token", "ERC20-RSRV");
        erc20Reward = await ERC20Factory.deploy("ERC20 Token Reward", "ERC20-R");
        
        //console.log("before each №1");
    });
    
    it("staking factory", async() => {
        let count = await CommunityCoinFactory.instancesCount();
        await expect(count).to.be.equal(TWO);
    })

    it("sqrt coverage", async() => {
        const MockSrqtCoverageFactory = await ethers.getContractFactory("MockSrqtCoverage");
        let mockSrqtCoverageInstance = await MockSrqtCoverageFactory.deploy();

        let inputArr = [
            "0x100000000000000000000000000000000",
            "0x10000000000000000",
            "0x100000000",
            "0x100000",
            "0x400",
            "0x100",
            "0x10",
            "0x8",
            "0x4",
            "0x2",
            "0x1",
            "0x0",
            ];
        let expectArr = [
            "0x10000000000000000",
            "0x100000000",
            "0x10000",
            "0x400",
            "0x20",
            "0x10",
            "0x4",
            "0x2",
            "0x2",
            "0x1",
            "0x1",
            "0x0",
        ];

        let tmp;
        for (let i = 0; i< inputArr.length; i++) {
            tmp = await mockSrqtCoverageInstance.calculateSqrt(BigNumber.from(inputArr[i]));
            expect(
                BigNumber.from(tmp).eq(BigNumber.from(expectArr[i]))
            ).to.be.equal(true);
        }
        
    }); 


    it("shouldnt create with uniswap pair exists", async() => {
        await expect(CommunityCoin["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
            erc20ReservedToken.address,
            erc20TradedToken.address,
            lockupIntervalCount,
            reserveTokenClaimFraction,
            tradedTokenClaimFraction,
            lpClaimFraction,
            numerator,
            denominator
        )).to.be.revertedWith("NO_UNISWAP_V2_PAIR");
    });

    it("shouldnt create staking with the same token pairs", async() => {
        await expect(CommunityCoin["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
            erc20.address,
            erc20.address,
            lockupIntervalCount,
            reserveTokenClaimFraction,
            tradedTokenClaimFraction,
            lpClaimFraction,
            numerator,
            denominator
        )).to.be.revertedWith("CommunityCoin: IDENTICAL_ADDRESSES");
        
    });

    it("shouldnt create staking with the Zero token", async() => {
        await expect(CommunityCoin["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
            ZERO_ADDRESS,
            erc20.address,
            lockupIntervalCount,
            reserveTokenClaimFraction,
            tradedTokenClaimFraction,
            lpClaimFraction,
            numerator,
            denominator
        )).to.be.revertedWith("CommunityCoin: ZERO_ADDRESS");
        await expect(CommunityCoin["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
            erc20.address,
            ZERO_ADDRESS,
            lockupIntervalCount,
            reserveTokenClaimFraction,
            tradedTokenClaimFraction,
            lpClaimFraction,
            numerator,
            denominator
        )).to.be.revertedWith("CommunityCoin: ZERO_ADDRESS");
    });

    it("shouldnt create with wrong fractions", async() => {
        await expect(CommunityCoin["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
            erc20ReservedToken.address,
            erc20TradedToken.address,
            lockupIntervalCount,
            wrongClaimFraction,
            tradedTokenClaimFraction,
            lpClaimFraction,
            numerator,
            denominator
        )).to.be.revertedWith("CommunityCoin: WRONG_CLAIM_FRACTION");
        await expect(CommunityCoin["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
            erc20ReservedToken.address,
            erc20TradedToken.address,
            lockupIntervalCount,
            reserveTokenClaimFraction,
            wrongClaimFraction,
            lpClaimFraction,
            numerator,
            denominator
        )).to.be.revertedWith("CommunityCoin: WRONG_CLAIM_FRACTION");
    });
    
    
    describe("Hook tests", function () {   
        var uniswapRouterFactoryInstance;
        var uniswapRouterInstance;
        var communityStakingPoolWithHook;

        var walletTokens;
        var lptokens;

        beforeEach("deploying", async() => {
            uniswapRouterFactoryInstance = await ethers.getContractAt("IUniswapV2Factory",UNISWAP_ROUTER_FACTORY_ADDRESS);
            uniswapRouterInstance = await ethers.getContractAt("IUniswapV2Router02", UNISWAP_ROUTER);

            await uniswapRouterFactoryInstance.createPair(erc20ReservedToken.address, erc20TradedToken.address);
        
            let pairAddress = await uniswapRouterFactoryInstance.getPair(erc20ReservedToken.address, erc20TradedToken.address);

            pairInstance = await ethers.getContractAt("ERC20Mintable",pairAddress);

            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));

            const ts = await time.latest();
            const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                erc20ReservedToken.address,
                erc20TradedToken.address,
                ONE_ETH.mul(SEVEN),
                ONE_ETH.mul(SEVEN),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );
                          
            let tx = await CommunityCoinWithHook.connect(owner)["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
                erc20ReservedToken.address,
                erc20TradedToken.address,
                lockupIntervalCount,
                reserveTokenClaimFraction,
                tradedTokenClaimFraction,
                lpClaimFraction,
                numerator,
                denominator
            )

            const rc = await tx.wait(); // 0ms, as tx is already confirmed
            const event = rc.events.find(event => event.event === 'InstanceCreated');
            const [tokenA, tokenB, instance] = event.args;
            
            communityStakingPoolWithHook = await ethers.getContractAt("CommunityStakingPool",instance);
            
            // create pair Token2 => WETH
            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));

            await uniswapRouterInstance.connect(liquidityHolder).addLiquidityETH(
                erc20ReservedToken.address,
                ONE_ETH.mul(SEVEN),
                0,
                0,
                liquidityHolder.address,
                timeUntil,
                {value: ONE_ETH.mul(SEVEN) }
            );

            


        });

        it("test bonus tokens if not set", async() => {
                await mockHook.setupVars(ZERO,true);
                await communityStakingPoolWithHook.connect(bob)['buyLiquidityAndStake()']({value: ONE_ETH.mul(ONE) });
                
                walletTokens = await CommunityCoinWithHook.balanceOf(bob.address);
                lptokens = await pairInstance.balanceOf(communityStakingPoolWithHook.address);

                expect(lptokens).not.to.be.eq(ZERO);
                expect(lptokens).to.be.eq(walletTokens);
               
        });
        it("test bonus tokens if set", async() => {
                await mockHook.setupVars(TEN,true);
                await communityStakingPoolWithHook.connect(bob)['buyLiquidityAndStake()']({value: ONE_ETH.mul(ONE) });
                
                walletTokens = await CommunityCoinWithHook.balanceOf(bob.address);
                lptokens = await pairInstance.balanceOf(communityStakingPoolWithHook.address);

                expect(lptokens).not.to.be.eq(ZERO);
                expect(walletTokens.sub(lptokens)).to.be.eq(TEN);
               
        });
        describe("test transferHook ", function () {   
            beforeEach("before each", async() => {
                await communityStakingPoolWithHook.connect(bob)['buyLiquidityAndStake()']({value: ONE_ETH.mul(ONE) });
                
                walletTokens = await CommunityCoinWithHook.balanceOf(bob.address);
                lptokens = await pairInstance.balanceOf(communityStakingPoolWithHook.address);
                
            });
            it("should prevent transfer if disabled via hook contract", async() => {
                
                // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                expect(lptokens).not.to.be.eq(ZERO);
                expect(lptokens).to.be.eq(walletTokens);

                await mockHook.setupVars(ZERO,false);

                await expect(CommunityCoinWithHook.connect(bob).transfer(alice.address, walletTokens)).to.be.revertedWith("HOOK: TRANSFER_PREVENT");
                
            });

            it("should allow transfer if enabled via hook contract", async() => {
                
                // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                expect(lptokens).not.to.be.eq(ZERO);
                expect(lptokens).to.be.eq(walletTokens);

                await mockHook.setupVars(ZERO,true);

                await expect(CommunityCoinWithHook.connect(bob).transfer(alice.address, walletTokens)).not.to.be.revertedWith("HOOK: TRANSFER_PREVENT");
                
            });
        }); 

    });
    
    describe("Instance tests", function () {
        var uniswapRouterFactoryInstance;
        var uniswapRouterInstance;
        var communityStakingPool;
        var pairInstance;

        beforeEach("deploying", async() => {
            uniswapRouterFactoryInstance = await ethers.getContractAt("IUniswapV2Factory",UNISWAP_ROUTER_FACTORY_ADDRESS);
            uniswapRouterInstance = await ethers.getContractAt("IUniswapV2Router02", UNISWAP_ROUTER);

            await uniswapRouterFactoryInstance.createPair(erc20ReservedToken.address, erc20TradedToken.address);
        
            let pairAddress = await uniswapRouterFactoryInstance.getPair(erc20ReservedToken.address, erc20TradedToken.address);

            pairInstance = await ethers.getContractAt("ERC20Mintable",pairAddress);

            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));

            const ts = await time.latest();
            const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                erc20ReservedToken.address,
                erc20TradedToken.address,
                ONE_ETH.mul(SEVEN),
                ONE_ETH.mul(SEVEN),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            let tx = await CommunityCoin.connect(owner)["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
                erc20ReservedToken.address,
                erc20TradedToken.address,
                lockupIntervalCount,
                reserveTokenClaimFraction,
                tradedTokenClaimFraction,
                lpClaimFraction,
                numerator,
                denominator
            )

            const rc = await tx.wait(); // 0ms, as tx is already confirmed
            const event = rc.events.find(event => event.event === 'InstanceCreated');
            const [tokenA, tokenB, instance] = event.args;
            //console.log(tokenA, tokenB, instance, instancesCount);

            communityStakingPool = await ethers.getContractAt("CommunityStakingPool",instance);
            //console.log("before each №2");

            
        });

        it("shouldnt create another pair with equal tokens", async() => {
            await expect(CommunityCoin["produce(address,address,uint64,uint64,uint64,uint64,uint64,uint64)"](
                erc20ReservedToken.address,
                erc20TradedToken.address,
                lockupIntervalCount,
                reserveTokenClaimFraction,
                tradedTokenClaimFraction,
                lpClaimFraction,
                numerator,
                denominator
            )).to.be.revertedWith("CommunityCoin: PAIR_ALREADY_EXISTS");
        });

        describe("TrustedForwarder", function () {
            it("should be empty after init", async() => {
                expect(await CommunityCoin.connect(bob).isTrustedForwarder(ZERO_ADDRESS)).to.be.true;
            });

            it("should be setup by owner", async() => {
                await expect(CommunityCoin.connect(bob).setTrustedForwarder(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
                expect(await CommunityCoin.connect(bob).isTrustedForwarder(ZERO_ADDRESS)).to.be.true;
                await CommunityCoin.connect(owner).setTrustedForwarder(alice.address);
                expect(await CommunityCoin.connect(bob).isTrustedForwarder(alice.address)).to.be.true;
            });
            
            it("should drop trusted forward if trusted forward become owner ", async() => {
                await CommunityCoin.connect(owner).setTrustedForwarder(alice.address);
                expect(await CommunityCoin.connect(bob).isTrustedForwarder(alice.address)).to.be.true;
                await CommunityCoin.connect(owner).transferOwnership(alice.address);
                expect(await CommunityCoin.connect(bob).isTrustedForwarder(ZERO_ADDRESS)).to.be.true;
            });

            it("shouldnt become owner and trusted forwarder", async() => {
                await expect(CommunityCoin.connect(owner).setTrustedForwarder(owner.address)).to.be.revertedWith("FORWARDER_CAN_NOT_BE_OWNER");
            });
            
        });

        for (const trustedForwardMode of [false,true]) {
            context(`via ${trustedForwardMode ? 'trusted forwarder' : 'user'} call`, () => {
                
                beforeEach("deploying", async() => {
                    if (trustedForwardMode) {
                        await CommunityCoin.connect(owner).setTrustedForwarder(trustedForwarder.address);
                    }
                });
                
                describe("through erc20ReservedToken", function () {
                    if (!trustedForwardMode) {
                        it("beneficiary test", async () => {
                        
                            await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                            await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));

                            let walletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                            let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);
                            
                            await communityStakingPool.connect(bob)['buyLiquidityAndStake(uint256,address)'](ONE_ETH.mul(ONE), charlie.address);

                            let walletTokens = await CommunityCoin.balanceOf(charlie.address);
                            let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                            // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                            expect(BigNumber.from(lptokens)).not.to.be.eq(ZERO);
                            expect(lptokens).to.be.eq(walletTokens);

                            expect(walletTokensBefore).not.to.be.eq(walletTokens);
                            expect(lptokens).not.to.be.eq(lptokensBefore);
                        
                        });
                    }
                    // it("TrustedForwarder test", async() => {
                    //     await CommunityCoin.connect(owner).setTrustedForwarder(alice.address);
                        
                    //     await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                    //     await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));

                    //     let walletTokensBefore = await CommunityCoin.balanceOf(bob.address);
                    //     let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);

                    //     //await communityStakingPool.connect(alice)['buyLiquidityAndStake(uint256)'](ONE_ETH.mul(ONE));
                    //     // trick with set up msgsender for TrustedForwarder calls
                    //     const lqBuyTx = await communityStakingPool.connect(alice).populateTransaction['buyLiquidityAndStake(uint256)'](ONE_ETH.mul(ONE));
                    //     lqBuyTx.data = lqBuyTx.data.concat((bob.address).substring(2));
                    //     await alice.sendTransaction(lqBuyTx);
                    //     //-----

                    //     let walletTokens = await CommunityCoin.balanceOf(bob.address);
                    //     let lptokens = await pairInstance.balanceOf(communityStakingPool.address);

                    //     // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                    //     expect(BigNumber.from(lptokens)).not.to.be.eq(ZERO);
                    //     expect(lptokens).to.be.eq(walletTokens);

                    //     expect(walletTokensBefore).not.to.be.eq(walletTokens);
                    //     expect(lptokens).not.to.be.eq(lptokensBefore);
                    // }); 
                    describe("when uniswap reserves in pools are equal", function () {
                        var stakingBalanceToken1Before;
                        var stakingBalanceToken2Before;
                        var stakingBalanceToken1After;
                        var stakingBalanceToken2After;

                        var bobWalletTokensBefore;
                        var bobLptokensBefore;

                        beforeEach("deploying", async() => {
                            await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                            await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));

                            bobWalletTokensBefore = await CommunityCoin.balanceOf(bob.address);
                            bobLptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);

                            stakingBalanceToken1Before = await erc20ReservedToken.balanceOf(communityStakingPool.address);
                            stakingBalanceToken2Before = await erc20TradedToken.balanceOf(communityStakingPool.address);

                            if (trustedForwardMode) {
                                const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyLiquidityAndStake(uint256)'](ONE_ETH.mul(ONE));
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await trustedForwarder.sendTransaction(dataTx);
                            } else {
                                await communityStakingPool.connect(bob)['buyLiquidityAndStake(uint256)'](ONE_ETH.mul(ONE));
                            }

                            stakingBalanceToken1After = await erc20ReservedToken.balanceOf(communityStakingPool.address);
                            stakingBalanceToken2After = await erc20TradedToken.balanceOf(communityStakingPool.address);
                        });

                        it("buyAddLiquidityAndStake", async () => {
                    
                            let walletTokens = await CommunityCoin.balanceOf(bob.address);
                            let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                            // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                            expect(BigNumber.from(lptokens)).not.to.be.eq(ZERO);
                            expect(lptokens).to.be.eq(walletTokens);

                            expect(bobWalletTokensBefore).not.to.be.eq(walletTokens);
                            expect(bobLptokensBefore).not.to.be.eq(lptokens);
                        
                        }); 

                        it("shouldnt unstake if not unlocked yet", async () => {
                        
                            let walletTokens = await CommunityCoin.balanceOf(bob.address);

                            expect(walletTokens).to.not.equal(ZERO);
                            
                            // even if approve before
                            if (trustedForwardMode) {
                                const dataTx = await CommunityCoin.connect(trustedForwarder).populateTransaction.approve(CommunityCoin.address, walletTokens);
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await trustedForwarder.sendTransaction(dataTx);
                            } else {
                                await CommunityCoin.connect(bob).approve(CommunityCoin.address, walletTokens);
                            }

                            if (trustedForwardMode) {
                                const dataTx = await CommunityCoin.connect(trustedForwarder).populateTransaction.unstake(walletTokens);
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await expect(trustedForwarder.sendTransaction(dataTx)).to.be.revertedWith('STAKE_NOT_UNLOCKED_YET');
                            } else {
                                await expect(CommunityCoin.connect(bob).unstake(walletTokens)).to.be.revertedWith('STAKE_NOT_UNLOCKED_YET');
                            }
                        });  

                        it("shouldnt redeem if not unlocked yet", async () => {
                            let dataTx;
                            let walletTokens = await CommunityCoin.balanceOf(bob.address);

                            expect(walletTokens).to.not.equal(ZERO);
                            
                            // even if approve before
                            if (trustedForwardMode) {
                                dataTx = await CommunityCoin.connect(trustedForwarder).populateTransaction.approve(CommunityCoin.address, walletTokens);
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await trustedForwarder.sendTransaction(dataTx);
                            } else {
                                await CommunityCoin.connect(bob).approve(CommunityCoin.address, walletTokens);
                            }
                            
                            let revertMsg = [
                                        "AccessControl: account ",
                                        (bob.address).toLowerCase(),
                                        " is missing role ",
                                        "0x"+padZeros(convertToHex(REDEEM_ROLE),64)
                                    ].join("");

                            if (trustedForwardMode) {
                                dataTx = await CommunityCoin.connect(trustedForwarder).populateTransaction['redeem(uint256)'](walletTokens);
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await expect(trustedForwarder.sendTransaction(dataTx)).to.be.revertedWith(revertMsg);
                            } else {
                                await expect(CommunityCoin.connect(bob)['redeem(uint256)'](walletTokens)).to.be.revertedWith(revertMsg);
                            }
                            
                        }); 

                        it("should transfer wallet tokens after stake", async() => {
                            
                            let bobSharesAfter = await CommunityCoin.balanceOf(bob.address);

                            let bobLockedBalanceAfter = await CommunityCoin.connect(bob).viewLockedWalletTokens(bob.address);
                            let aliceLockedBalanceAfter = await CommunityCoin.connect(bob).viewLockedWalletTokens(alice.address);
                            expect(aliceLockedBalanceAfter).to.be.eq(ZERO);
                            expect(bobLockedBalanceAfter).to.be.eq(bobSharesAfter);

                            if (trustedForwardMode) {
                                const dataTx = await CommunityCoin.connect(trustedForwarder).populateTransaction.transfer(alice.address, bobSharesAfter);
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await trustedForwarder.sendTransaction(dataTx);
                            } else {
                                await CommunityCoin.connect(bob).transfer(alice.address, bobSharesAfter);
                            }
                            

                            let bobSharesAfterTransfer = await CommunityCoin.balanceOf(bob.address);
                            let aliceSharesAfterBobTransfer = await CommunityCoin.balanceOf(alice.address);
                            let bobLockedBalanceAfterBobTransfer = await CommunityCoin.connect(bob).viewLockedWalletTokens(bob.address);
                            let aliceLockedBalanceAfterBobTransfer = await CommunityCoin.connect(bob).viewLockedWalletTokens(alice.address);

                            expect(bobSharesAfterTransfer).to.be.eq(ZERO);
                            expect(bobSharesAfter).to.be.eq(aliceSharesAfterBobTransfer);
                            expect(bobLockedBalanceAfterBobTransfer).to.be.eq(ZERO);
                            expect(aliceLockedBalanceAfterBobTransfer).to.be.eq(ZERO);
                            
                            
                        });

                        it("should consume all traded tokens when buying liquidity", async () => {
                            
                            expect(
                                BigNumber.from(stakingBalanceToken2Before).lte(BigNumber.from(percentLimitLeftTokenB*ONE_ETH))
                            ).to.be.eq(true);

                            expect(
                                BigNumber.from(stakingBalanceToken2After).lte(BigNumber.from(percentLimitLeftTokenB*ONE_ETH))
                            ).to.be.eq(true);
                        });

                    });
                    describe("when uniswap reserves in pools are not equal", function () {
                        var stakingBalanceToken1Before;
                        var stakingBalanceToken2Before;
                        var stakingBalanceToken1After;
                        var stakingBalanceToken2After;
                        beforeEach("deploying", async() => {

                            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN).mul(THOUSAND));
                            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(FOUR).mul(TEN).mul(THOUSAND));
                            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN).mul(THOUSAND));
                            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(FOUR).mul(TEN).mul(THOUSAND));

                            const ts = await time.latest();
                            const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

                            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                                erc20ReservedToken.address,
                                erc20TradedToken.address,
                                ONE_ETH.mul(TEN).mul(THOUSAND),             // 10000
                                ONE_ETH.mul(FOUR).mul(TEN).mul(THOUSAND),   // 40000
                                0,
                                0,
                                liquidityHolder.address,
                                timeUntil
                            );

                            await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                            await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));

                            // 50000
                            await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(FOUR).mul(TEN).mul(THOUSAND));
                            await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(FOUR).mul(TEN).mul(THOUSAND));

                            stakingBalanceToken1Before = await erc20ReservedToken.balanceOf(communityStakingPool.address);
                            stakingBalanceToken2Before = await erc20TradedToken.balanceOf(communityStakingPool.address);

                            if (trustedForwardMode) {
                                const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyLiquidityAndStake(uint256)'](ONE_ETH.mul(ONE));
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await trustedForwarder.sendTransaction(dataTx);
                            } else {
                                await communityStakingPool.connect(bob)['buyLiquidityAndStake(uint256)'](ONE_ETH.mul(ONE));
                            }

                            stakingBalanceToken1After = await erc20ReservedToken.balanceOf(communityStakingPool.address);
                            stakingBalanceToken2After = await erc20TradedToken.balanceOf(communityStakingPool.address);
                        });

                        it("should consume all traded tokens when buying liquidity", async () => {
                            expect(
                                BigNumber.from(stakingBalanceToken2Before).lte(BigNumber.from(percentLimitLeftTokenB*ONE_ETH))
                            ).to.be.eq(true);

                            expect(
                                BigNumber.from(stakingBalanceToken2After).lte(BigNumber.from(percentLimitLeftTokenB*ONE_ETH))
                            ).to.be.eq(true);
                        });
                    });
                });

                describe("through paying token", function () {
                    beforeEach("deploying", async() => {
                        await erc20.mint(bob.address, ONE_ETH.mul(ONE));
                    
                        await erc20.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));

                        // create pair Token2 => Token3
                        await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
                        await erc20.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
                        await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));
                        await erc20.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));

                        const ts = await time.latest();
                        const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

                        await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                            erc20ReservedToken.address,
                            erc20.address,
                            ONE_ETH.mul(SEVEN),
                            ONE_ETH.mul(SEVEN),
                            0,
                            0,
                            liquidityHolder.address,
                            timeUntil
                        );
                    });

                    it("buyAddLiquidityAndStake", async () => {
                
                        // now addinig liquidity through paying token will be successful
                        if (trustedForwardMode) {
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyLiquidityAndStake(address,uint256)'](erc20.address, ONE_ETH.mul(ONE));
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyLiquidityAndStake(address,uint256)'](erc20.address, ONE_ETH.mul(ONE));
                        }
                    
                        let walletTokens = await CommunityCoin.balanceOf(bob.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake

                        expect(lptokens).not.to.be.eq(ZERO);
                        expect(lptokens).to.be.eq(walletTokens);
                    
                    });    

                    it("buyAddLiquidityAndStake (beneficiary)", async () => {
                
                        let walletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                        let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);

                        // now addinig liquidity through paying token will be successful
                        if (trustedForwardMode) {
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyLiquidityAndStake(address,uint256,address)'](erc20.address, ONE_ETH.mul(ONE), charlie.address);
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyLiquidityAndStake(address,uint256,address)'](erc20.address, ONE_ETH.mul(ONE), charlie.address);
                        }
                    
                        let walletTokens = await CommunityCoin.balanceOf(charlie.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake

                        expect(lptokens).not.to.be.eq(ZERO);
                        expect(lptokens).to.be.eq(walletTokens);

                        expect(walletTokensBefore).not.to.be.eq(walletTokens);
                        expect(lptokensBefore).not.to.be.eq(lptokens);
                    
                    });    
                });

                

                describe("through ETH", function () {
                    beforeEach("deploying", async() => {
                        // create pair Token2 => WETH
                        await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
                        await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));

                        const ts = await time.latest();
                        const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

                        await uniswapRouterInstance.connect(liquidityHolder).addLiquidityETH(
                            erc20ReservedToken.address,
                            ONE_ETH.mul(SEVEN),
                            0,
                            0,
                            liquidityHolder.address,
                            timeUntil,
                            {value: ONE_ETH.mul(SEVEN) }
                        );
                    
                    });
                    
                    it("buyAddLiquidityAndStake", async () => {
                        
                        await communityStakingPool.connect(bob)['buyLiquidityAndStake()']({value: ONE_ETH.mul(ONE) });
                        if (trustedForwardMode) {
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyLiquidityAndStake()']({value: ONE_ETH.mul(ONE) });
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyLiquidityAndStake()']({value: ONE_ETH.mul(ONE) });
                        }
    
                        let walletTokens = await CommunityCoin.balanceOf(bob.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                        
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                        expect(lptokens).not.to.be.eq(ZERO);
                        expect(lptokens).to.be.eq(walletTokens);
                        
                    });    

                    it("buyAddLiquidityAndStake (beneficiary)", async () => {
                        let walletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                        let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);

                        if (trustedForwardMode) {
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyLiquidityAndStake(address)'](charlie.address, {value: ONE_ETH.mul(ONE) });
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyLiquidityAndStake(address)'](charlie.address, {value: ONE_ETH.mul(ONE) });
                        }

                        
                        let walletTokens = await CommunityCoin.balanceOf(charlie.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                        
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                        expect(lptokens).not.to.be.eq(ZERO);
                        expect(lptokens).to.be.eq(walletTokens);
                        
                        expect(walletTokensBefore).not.to.be.eq(walletTokens);
                        expect(lptokensBefore).not.to.be.eq(lptokens);
                    });   
                });
            });
        } //end for

        describe("factory tests", function() {
            var instanceManagementInstance;
            beforeEach("before each callback", async() => {
                let instanceManagementAddr = await CommunityCoin.connect(bob).instanceManagment();
                instanceManagementInstance = await ethers.getContractAt("CommunityCoinInstances",instanceManagementAddr);
                
            });
            it("should return instance info", async () => {
                
                let data = await instanceManagementInstance.connect(bob).getInstanceInfo(erc20ReservedToken.address, erc20TradedToken.address, lockupIntervalCount);
                
                expect(data.reserveToken).to.be.eq(erc20ReservedToken.address);
                expect(data.tradedToken).to.be.eq(erc20TradedToken.address);
                expect(data.duration).to.be.eq(lockupIntervalCount);
                
            }); 
            
            it("should return correct instance length", async () => {
                let data = await instanceManagementInstance.connect(bob).instancesCount();
                expect(data).to.be.eq(ONE);
            }); 
        }); 
 
        describe("unstake/redeem/redeem-and-remove-liquidity tests", function () {
            var shares;
            beforeEach("before each callback", async() => {
                
                await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));
                await communityStakingPool.connect(bob)['buyLiquidityAndStake(uint256)'](ONE_ETH.mul(ONE));
                shares = await CommunityCoin.balanceOf(bob.address);
            });

            it("should wallet tokens appear and not equal zero", async () => {
                expect(shares).to.not.equal(ZERO);
            });

            it("should burn tokens without descreasing any 'redeem' variables", async () => {

                var uniswapV2PairAddress;
                var uniswapV2PairInstance;

                uniswapV2PairAddress = await communityStakingPool.uniswapV2Pair();
                uniswapV2PairInstance = await ethers.getContractAt("ERC20Mintable",uniswapV2PairAddress);

                let bobLPTokenBefore = await uniswapV2PairInstance.balanceOf(bob.address);
                await CommunityCoin.connect(bob).burn(shares, []);
                let bobLPTokenAfter = await uniswapV2PairInstance.balanceOf(bob.address);

                expect(bobLPTokenAfter).equal(bobLPTokenBefore);
            });

            describe("unstake tests", function () {
                describe("shouldnt unstake", function () {
                    it("if not unlocked yet", async () => {
                        await expect(CommunityCoin.connect(bob)["unstake(uint256)"](shares)).to.be.revertedWith("STAKE_NOT_UNLOCKED_YET");
                    });
                    it("if amount more than balance", async () => {
                        // pass some mtime
                        await time.increase(lockupIntervalCount*dayInSeconds+9);    

                        await expect(CommunityCoin.connect(bob)["unstake(uint256)"](shares.add(ONE_ETH))).to.be.revertedWith("INSUFFICIENT_BALANCE");
                    });
                });
                describe("should unstake", function () {
                    it("successfull", async () => {
                        // pass some mtime
                        await time.increase(lockupIntervalCount*dayInSeconds+9);    
                        
                        let bobReservedTokenBefore = await erc20ReservedToken.balanceOf(bob.address);
                        let bobTradedTokenBefore = await erc20TradedToken.balanceOf(bob.address);

                        await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);
                        await CommunityCoin.connect(bob)["unstake(uint256)"](shares);

                        let bobReservedTokenAfter = await erc20ReservedToken.balanceOf(bob.address);
                        let bobTradedTokenAfter = await erc20TradedToken.balanceOf(bob.address);

                        expect(bobReservedTokenAfter).gt(bobReservedTokenBefore);
                        expect(bobTradedTokenAfter).gt(bobTradedTokenBefore);
                    });
                });
            });

            //                      redeem , redeemAndRemoveLiquidity                                    
            for (const forkAction of [true, false]) {

                context(`${forkAction ? 'redeem' : 'redeem and remove liquidity(RRL)'} reserve token`, () => {
                    describe(`shouldnt ${forkAction ? 'redeem' : 'RRL' }`, function () {
                        describe("without redeem role", function () {
                            it("if anyone didn't transfer tokens to you before", async () => {
                                await expect(CommunityCoin.connect(bob)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                    [
                                        "AccessControl: account ",
                                        (bob.address).toLowerCase(),
                                        " is missing role ",
                                        "0x"+padZeros(convertToHex(REDEEM_ROLE),64)
                                    ].join("")
                                );
                            });
                            describe("after someone transfer", function () {  
                                beforeEach("before each callback", async() => {
                                    await CommunityCoin.connect(bob).transfer(alice.address, shares);
                                });  
                                
                                it("without approve before", async () => {
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        [
                                            "AccessControl: account ",
                                            (alice.address).toLowerCase(),
                                            " is missing role ",
                                            "0x"+padZeros(convertToHex(REDEEM_ROLE),64)
                                        ].join("")
                                    );
                                });
                                it("without approve before even if passed time", async () => {
                                    // pass some mtime
                                    await time.increase(lockupIntervalCount*dayInSeconds+9);    
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        [
                                            "AccessControl: account ",
                                            (alice.address).toLowerCase(),
                                            " is missing role ",
                                            "0x"+padZeros(convertToHex(REDEEM_ROLE),64)
                                        ].join("")
                                    );
                                });
                                
                                it("with approve before", async () => {
                                    await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        [
                                            "AccessControl: account ",
                                            (alice.address).toLowerCase(),
                                            " is missing role ",
                                            "0x"+padZeros(convertToHex(REDEEM_ROLE),64)
                                        ].join("")
                                    );
                                });
                                it("with approve before even if passed time", async () => {
                                    await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);
                                    // pass some mtime
                                    await time.increase(lockupIntervalCount*dayInSeconds+9);    

                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        [
                                            "AccessControl: account ",
                                            (alice.address).toLowerCase(),
                                            " is missing role ",
                                            "0x"+padZeros(convertToHex(REDEEM_ROLE),64)
                                        ].join("")
                                    );

                                });
                            
                            });     
                        
                        });

                        describe("with redeem role", function () {
                            beforeEach("before each callback", async() => {
                                // grant role to bob
                                await CommunityCoin.connect(owner).grantRole(ethers.utils.formatBytes32String(REDEEM_ROLE), bob.address);
                            });

                            it("if anyone didn't transfer tokens to you before", async () => {
                                await expect(CommunityCoin.connect(bob)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith("Amount exceeds allowance");
                            });
        
                            it("but without transfer to some one", async () => {
                                // means that bob have tokens(after stake), he have redeem role, but totalRedeemable are zero
                                // here it raise a erc777 
                                
                                await CommunityCoin.connect(owner).grantRole(ethers.utils.formatBytes32String(REDEEM_ROLE), bob.address);
                                await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);

                                await expect(CommunityCoin.connect(bob)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith("INSUFFICIENT_BALANCE");
                            });
                            
                            describe("after someone transfer", function () {  
                                beforeEach("before each callback", async() => {
                                    await CommunityCoin.connect(bob).transfer(alice.address, shares);
                                    // grant role to alice
                                    await CommunityCoin.connect(owner).grantRole(ethers.utils.formatBytes32String(REDEEM_ROLE), alice.address);
                                });  
                                
                                it("without approve before", async () => {
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith("Amount exceeds allowance");
                                });
                                it("without approve before even if passed time", async () => {
                                    // pass some mtime
                                    await time.increase(lockupIntervalCount*dayInSeconds+9);    
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith("Amount exceeds allowance");
                                });
                                
                            });      

                        });

                    });
                    describe("should redeem", function () {
                        var uniswapV2PairAddress;
                        var uniswapV2PairInstance;
                        var aliceLPTokenBefore;
                        var aliceReservedTokenBefore;
                        var aliceTradedTokenBefore;
                        var aliceLPTokenAfter;
                        beforeEach("before each callback", async() => {
                            // pass some mtime
                            await time.increase(lockupIntervalCount*dayInSeconds+9);    
                            // grant role
                            await CommunityCoin.connect(owner).grantRole(ethers.utils.formatBytes32String(REDEEM_ROLE), alice.address);

                            // transfer from bob to alice
                            await CommunityCoin.connect(bob).transfer(alice.address, shares);
                            //await CommunityCoin.connect(owner).grantRole(ethers.utils.formatBytes32String(REDEEM_ROLE), alice.address);

                            //after that, when alice has obtain tokens she can redeem 
                            uniswapV2PairAddress = await communityStakingPool.uniswapV2Pair();
                            uniswapV2PairInstance = await ethers.getContractAt("ERC20Mintable",uniswapV2PairAddress);

                            aliceLPTokenBefore = await uniswapV2PairInstance.balanceOf(alice.address);

                            aliceReservedTokenBefore = await erc20ReservedToken.balanceOf(alice.address);
                            aliceTradedTokenBefore = await erc20TradedToken.balanceOf(alice.address);
                        });
                        it(""+`via ${forkAction ? 'redeem' : 'redeemAndRemoveLiquidity'} method`, async () => {
                            
                            await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);

                            await CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares);

                            aliceLPTokenAfter = await uniswapV2PairInstance.balanceOf(alice.address);
                            aliceReservedTokenAfter = await erc20ReservedToken.balanceOf(alice.address);
                            aliceTradedTokenAfter = await erc20TradedToken.balanceOf(alice.address);
                            if (forkAction) {
                                expect(aliceLPTokenAfter).gt(aliceLPTokenBefore);
                            } else {
                                expect(aliceReservedTokenAfter).gt(aliceReservedTokenBefore);
                                expect(aliceTradedTokenAfter).gt(aliceTradedTokenBefore);
                            }


                            
                        });

                        if (forkAction) {
                            it("via directly send to contract", async () => {

                                await CommunityCoin.connect(alice).transfer(CommunityCoin.address, shares);

                                aliceLPTokenAfter = await uniswapV2PairInstance.balanceOf(alice.address);

                                expect(aliceLPTokenAfter).gt(aliceLPTokenBefore);
                            });
                        }
                        
                    
                    });
                });

            } // end for 
            

        
        });      
        
    });

});