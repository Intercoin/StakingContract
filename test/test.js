const { ethers, waffle } = require('hardhat');
const { BigNumber } = require('ethers');
const { expect } = require('chai');
const chai = require('chai');
const { time } = require('@openzeppelin/test-helpers');

const ZERO = BigNumber.from('0');
const ONE = BigNumber.from('1');
const TWO = BigNumber.from('2');
const THREE = BigNumber.from('3');
const FOUR = BigNumber.from('4');
const FIVE = BigNumber.from('5');
const SIX = BigNumber.from('6');
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

const INVITEDBY_FRACTION = 0;

const REDEEM_ROLE       = 0x2;//'redeem';
const CIRCULATE_ROLE    = 0x3;//'circulate';
const TARIFF_ROLE       = 0x4;//'tariff';

const FRACTION = BigNumber.from('100000');

const NO_DONATIONS = [];

const NO_BONUS_FRACTIONS = ZERO; // no bonus. means amount*NO_BONUS_FRACTIONS/FRACTION = X*0/100000 = 0
const BONUS_FRACTIONS = 50000; // 50%

const PRICE_DENOM = 100_000_000; // 1e8



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
    const david = accounts[4];
    const frank = accounts[5];
    
    const lpFraction = ZERO;
    const numerator = 1;
    const denominator = 1;
    const dayInSeconds = 24*60*60; // * interval: DAY in seconds
    const lockupIntervalCount = 365; // year in days(dayInSeconds)
    const percentLimitLeftTokenB = 0.001;

    const discountSensitivity = 1*FRACTION;
    const rewardsRateFraction = FRACTION;

    const rewardsTenPercentBonus = 10;

    var implementationCommunityCoin;
    var implementationCommunityStakingPoolFactory;
    var implementationCommunityStakingPool;
    var implementationCommunityStakingPoolErc20;

    var rewardsHook;
    var mockCommunity;
    var ERC20Factory;
    var ERC777Factory;
    var CommunityCoinFactory;
    var CommunityCoin;
    var CommunityCoinWithRewardsHook;
    var erc20;
    var erc777;
    var erc20TradedToken;
    var erc20ReservedToken;
    var erc20Reward;
    var fakeUSDT;
    var fakeMiddle;
    
    beforeEach("deploying", async() => {
        const ReleaseManagerFactoryF = await ethers.getContractFactory("MockReleaseManagerFactory");
        const ReleaseManagerF = await ethers.getContractFactory("MockReleaseManager");
        const CommunityCoinFactoryF = await ethers.getContractFactory("CommunityCoinFactory");

        const PoolStakesLibF = await ethers.getContractFactory("PoolStakesLib");
	    let poolStakesLib = await PoolStakesLibF.deploy();
        
        const CommunityCoinF = await ethers.getContractFactory("CommunityCoin", {
            libraries: {
                "contracts/libs/PoolStakesLib.sol:PoolStakesLib": poolStakesLib.address
            }
        });
        const CommunityStakingPoolF = await ethers.getContractFactory("MockCommunityStakingPool");
        const CommunityStakingPoolErc20F = await ethers.getContractFactory("CommunityStakingPoolErc20");
        const CommunityStakingPoolFactoryF = await ethers.getContractFactory("CommunityStakingPoolFactory");

        const RewardsF = await ethers.getContractFactory("Rewards");
        const MockCommunityF = await ethers.getContractFactory("MockCommunity");
        ERC20Factory = await ethers.getContractFactory("ERC20Mintable");
        ERC777Factory = await ethers.getContractFactory("ERC777Mintable");
        
        
        let implementationReleaseManager    = await ReleaseManagerF.deploy();

        let releaseManagerFactory   = await ReleaseManagerFactoryF.connect(owner).deploy(implementationReleaseManager.address);
        let tx,rc,event,instance,instancesCount;
        //
        tx = await releaseManagerFactory.connect(owner).produce();
        rc = await tx.wait(); // 0ms, as tx is already confirmed
        event = rc.events.find(event => event.event === 'InstanceProduced');
        [instance, instancesCount] = event.args;
        let releaseManager = await ethers.getContractAt("MockReleaseManager",instance);

        erc20 = await ERC20Factory.deploy("ERC20 Token", "ERC20");
        erc777 = await ERC777Factory.deploy("ERC777 Token", "ERC777");
        erc20TradedToken = await ERC20Factory.deploy("ERC20 Traded Token", "ERC20-TRD");
        erc20ReservedToken = await ERC20Factory.deploy("ERC20 Reserved Token", "ERC20-RSRV");
        erc20Reward = await ERC20Factory.deploy("ERC20 Token Reward", "ERC20-R");

        implementationCommunityCoin = await CommunityCoinF.deploy();
        implementationCommunityStakingPoolFactory = await CommunityStakingPoolFactoryF.deploy();
        implementationCommunityStakingPool = await CommunityStakingPoolF.deploy();
        implementationCommunityStakingPoolErc20 = await CommunityStakingPoolErc20F.deploy();

        rewardsHook = await RewardsF.deploy();

        const PRICE_REWARDS = PRICE_DENOM;
        let timeLatest = await time.latest();

        await rewardsHook.connect(owner).initialize(
            erc20Reward.address,                    //address sellingToken,
            [timeLatest.toString()],                //uint256[] memory timestamps,
            [PRICE_REWARDS],                        // uint256[] memory _prices,
            [ethers.utils.parseEther("0.00001")],   // uint256[] memory thresholds,
            [rewardsTenPercentBonus]   // 10%                           // uint256[] memory bonuses
        )
        


        mockCommunity = await MockCommunityF.deploy();

        const COMMUNITY_SETTINGS = [
            INVITEDBY_FRACTION,
            mockCommunity.address, 
            REDEEM_ROLE, 
            CIRCULATE_ROLE,
            TARIFF_ROLE
        ];

        const NO_COSTMANAGER = ZERO_ADDRESS;
        
        CommunityCoinFactory  = await CommunityCoinFactoryF.deploy(
            implementationCommunityCoin.address, 
            implementationCommunityStakingPoolFactory.address, 
            implementationCommunityStakingPool.address, 
            implementationCommunityStakingPoolErc20.address,
            NO_COSTMANAGER
        );

        // 
        const factoriesList = [CommunityCoinFactory.address];
        const factoryInfo = [
            [
                1,//uint8 factoryIndex; 
                1,//uint16 releaseTag; 
                "0x53696c766572000000000000000000000000000000000000"//bytes24 factoryChangeNotes;
            ]
        ]
        await CommunityCoinFactory.connect(owner).registerReleaseManager(releaseManager.address);
        await releaseManager.connect(owner).newRelease(factoriesList, factoryInfo);

        // without hook
        tx = await CommunityCoinFactory.connect(owner).produce(erc20ReservedToken.address, erc20TradedToken.address, ZERO_ADDRESS, discountSensitivity, COMMUNITY_SETTINGS);
        rc = await tx.wait(); // 0ms, as tx is already confirmed
        event = rc.events.find(event => event.event === 'InstanceCreated');
        [instance, instancesCount] = event.args;
        CommunityCoin = await ethers.getContractAt("CommunityCoin",instance);

        // with hook
        tx = await CommunityCoinFactory.connect(owner).produce(erc20ReservedToken.address, erc20TradedToken.address, rewardsHook.address, discountSensitivity, COMMUNITY_SETTINGS);
        rc = await tx.wait(); // 0ms, as tx is already confirmed
        event = rc.events.find(event => event.event === 'InstanceCreated');
        [instance, instancesCount] = event.args;
        CommunityCoinWithRewardsHook = await ethers.getContractAt("CommunityCoin",instance);
        
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
        await expect(CommunityCoin["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
            lockupIntervalCount,
            NO_BONUS_FRACTIONS,
            NO_DONATIONS,
            lpFraction,
            ZERO_ADDRESS,
            rewardsRateFraction,
            numerator,
            denominator
        )).to.be.revertedWith("NO_UNISWAP_V2_PAIR");
    });
    
    it("should produce with default values", async() => {
        let uniswapRouterFactoryInstance = await ethers.getContractAt("IUniswapV2Factory",UNISWAP_ROUTER_FACTORY_ADDRESS);
        let uniswapRouterInstance = await ethers.getContractAt("IUniswapV2Router02", UNISWAP_ROUTER);

        await uniswapRouterFactoryInstance.createPair(erc20ReservedToken.address, erc20TradedToken.address);
    
        let pairAddress = await uniswapRouterFactoryInstance.getPair(erc20ReservedToken.address, erc20TradedToken.address);

        let pairInstance = await ethers.getContractAt("ERC20Mintable",pairAddress);

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


        let tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
            lockupIntervalCount,
            NO_BONUS_FRACTIONS,
            NO_DONATIONS,
            lpFraction,
            ZERO_ADDRESS,
            rewardsRateFraction,
            numerator,
            denominator
        )

        const rc = await tx.wait(); // 0ms, as tx is already confirmed
        const event = rc.events.find(event => event.event === 'InstanceCreated');
        const [tokenA, tokenB, instance] = event.args;

        expect(instance).not.to.be.eq(ZERO_ADDRESS); 
    });

    
    it("should change inviteByFraction ", async() => {
        const oldInvitedByFraction = await CommunityCoin.invitedByFraction();
        const toSetInvitedByFraction = FRACTION.sub(123);
        await expect(CommunityCoin.connect(alice).setCommission(toSetInvitedByFraction)).to.be.revertedWith("Ownable: caller is not the owner");
        await CommunityCoin.connect(owner).setCommission(toSetInvitedByFraction);
        const newInvitedByFraction = await CommunityCoin.invitedByFraction();

        expect(oldInvitedByFraction).to.be.eq(INVITEDBY_FRACTION);
        expect(newInvitedByFraction).to.be.eq(toSetInvitedByFraction);
    });


    describe("tariff tests", function () {
        var uniswapRouterFactoryInstance;
        var uniswapRouterInstance;
        var communityStakingPool;
        var pairInstance;
        var shares;

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

            // add liquidity into erc20ReservedToken::USDT and erc20TradedToken::USDT
            fakeUSDT = await ERC20Factory.deploy("FAKE USDT Token", "FUSDT");
            await fakeUSDT.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED).mul(TWO));
            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));

            await fakeUSDT.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeUSDT.address,
                erc20TradedToken.address,
                ONE_ETH.mul(HUNDRED),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            await fakeUSDT.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeUSDT.address,
                erc20ReservedToken.address,
                ONE_ETH.mul(HUNDRED),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );
            // add liquidity into erc20ReservedToken::middleToken, erc20TradedToken::middleToken and middleToken::USDT
            fakeMiddle = await ERC20Factory.deploy("FAKE Middle Token", "FMT");

            await fakeMiddle.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED).mul(TEN));
            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));
            await fakeUSDT.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));

            //erc20ReservedToken::middleToken
            await fakeMiddle.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED).mul(TWO));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeMiddle.address,
                erc20ReservedToken.address,
                ONE_ETH.mul(HUNDRED).mul(TWO),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            //erc20TradedToken::middleToken
            await fakeMiddle.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED).mul(TWO));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeMiddle.address,
                erc20TradedToken.address,
                ONE_ETH.mul(HUNDRED).mul(TWO),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            // middleToken::USDT
            await fakeMiddle.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED).mul(SIX));
            await fakeUSDT.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeMiddle.address,
                fakeUSDT.address,
                ONE_ETH.mul(HUNDRED).mul(SIX),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            //--------------------------------------------------

            let tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            )

            const rc = await tx.wait(); // 0ms, as tx is already confirmed
            const event = rc.events.find(event => event.event === 'InstanceCreated');
            const [tokenA, tokenB, instance] = event.args;
            //console.log(tokenA, tokenB, instance, instancesCount);

            communityStakingPool = await ethers.getContractAt("MockCommunityStakingPool",instance);
            //console.log("before each №2");

        });    
        it("shouldn't set tariff by owner or anyone except tariffrole memeber", async () => {
            await expect(CommunityCoin.connect(owner).setTariff(ONE, ONE)).to.be.revertedWith(`MissingRole("${owner.address}", ${TARIFF_ROLE})`);
            await expect(CommunityCoin.connect(bob).setTariff(ONE, ONE)).to.be.revertedWith(`MissingRole("${bob.address}", ${TARIFF_ROLE})`);
            await expect(CommunityCoin.connect(frank).setTariff(ONE, ONE)).to.be.revertedWith(`MissingRole("${frank.address}", ${TARIFF_ROLE})`);
        });    
        it("should set tariff(redeem / unstake)", async () => {
            await mockCommunity.connect(owner).setRoles(charlie.address, [TARIFF_ROLE]);
            await CommunityCoin.connect(charlie).setTariff(ONE, ONE);
        });

        it("shouldn't exсeed max tariff(redeem / unstake)", async () => {
            await mockCommunity.connect(owner).setRoles(charlie.address, [TARIFF_ROLE]);

            const MAX_REDEEM_TARIFF = await CommunityCoin.MAX_REDEEM_TARIFF();
            const MAX_UNSTAKE_TARIFF = await CommunityCoin.MAX_UNSTAKE_TARIFF(); 

            await expect(CommunityCoin.connect(charlie).setTariff(TWO.mul(MAX_REDEEM_TARIFF), ONE)).to.be.revertedWith(`AmountExceedsMaxTariff()`);
            await expect(CommunityCoin.connect(charlie).setTariff(ONE, TWO.mul(MAX_UNSTAKE_TARIFF))).to.be.revertedWith(`AmountExceedsMaxTariff()`);
            
        });

        describe("should consume by correct tariff", function () {
            var uniswapV2PairInstance;
            beforeEach("deploying", async() => {

                let uniswapV2PairAddress = await communityStakingPool.uniswapV2Pair();
                uniswapV2PairInstance = await ethers.getContractAt("ERC20Mintable",uniswapV2PairAddress);

                await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));
                await communityStakingPool.connect(bob)['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                shares = await CommunityCoin.balanceOf(bob.address);

                // pass some mtime
                await time.increase(lockupIntervalCount*dayInSeconds+9);    

            });
            it(" - when unstake", async () => {
                const MAX_UNSTAKE_TARIFF = await CommunityCoin.MAX_UNSTAKE_TARIFF(); 
                let snapId;
                let bobLPTokenWithoutTariff, bobLPTokenWithTariff;

                // make snapshot before time manipulations
                snapId = await ethers.provider.send('evm_snapshot', []);

                let bobLPTokenBefore1 = await uniswapV2PairInstance.balanceOf(bob.address);
                let bobReservedTokenBefore1 = await erc20ReservedToken.balanceOf(bob.address);
                let bobTradedTokenBefore1 = await erc20TradedToken.balanceOf(bob.address);

                await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);
                await CommunityCoin.connect(bob)["unstake(uint256)"](shares);

                let bobLPTokenAfter1 = await uniswapV2PairInstance.balanceOf(bob.address);
                let bobReservedTokenAfter1 = await erc20ReservedToken.balanceOf(bob.address);
                let bobTradedTokenAfter1 = await erc20TradedToken.balanceOf(bob.address);
                
                expect(bobLPTokenAfter1).gt(bobLPTokenBefore1);
                expect(bobReservedTokenAfter1).eq(bobReservedTokenBefore1);
                expect(bobTradedTokenAfter1).eq(bobTradedTokenBefore1);

                bobLPTokenWithoutTariff = bobLPTokenAfter1.sub(bobLPTokenBefore1)
                // restore snapshot
                await ethers.provider.send('evm_revert', [snapId]);
                //----------------------------------------------------------------
                // make snapshot before time manipulations
                snapId = await ethers.provider.send('evm_snapshot', []);

                await mockCommunity.connect(owner).setRoles(charlie.address, [TARIFF_ROLE]);
                await CommunityCoin.connect(charlie).setTariff(ONE, MAX_UNSTAKE_TARIFF);

                let bobLPTokenBefore2 = await uniswapV2PairInstance.balanceOf(bob.address);
                let bobReservedTokenBefore2 = await erc20ReservedToken.balanceOf(bob.address);
                let bobTradedTokenBefore2 = await erc20TradedToken.balanceOf(bob.address);

                await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);
                await CommunityCoin.connect(bob)["unstake(uint256)"](shares);

                let bobLPTokenAfter2 = await uniswapV2PairInstance.balanceOf(bob.address);
                let bobReservedTokenAfter2 = await erc20ReservedToken.balanceOf(bob.address);
                let bobTradedTokenAfter2 = await erc20TradedToken.balanceOf(bob.address);
                
                expect(bobLPTokenAfter2).gt(bobLPTokenBefore2);
                expect(bobReservedTokenAfter2).eq(bobReservedTokenBefore2);
                expect(bobTradedTokenAfter2).eq(bobTradedTokenBefore2);

                bobLPTokenWithTariff = bobLPTokenAfter2.sub(bobLPTokenBefore2)

                // restore snapshot
                await ethers.provider.send('evm_revert', [snapId]);

                // now check unstake tariff
                expect(bobLPTokenWithTariff).to.be.eq(bobLPTokenWithoutTariff.sub(bobLPTokenWithoutTariff.mul(MAX_UNSTAKE_TARIFF).div(FRACTION)));
            });
            it(" - when redeem", async () => {
                const MAX_REDEEM_TARIFF = await CommunityCoin.MAX_REDEEM_TARIFF();

                let snapId;
                let aliceLPTokenWithoutTariff, aliceLPTokenWithTariff;

                // imitate exists role
                await mockCommunity.connect(owner).setRoles(alice.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);
                // transfer from bob to alice
                await CommunityCoin.connect(bob).transfer(alice.address, shares);


                // make snapshot before time manipulations
                snapId = await ethers.provider.send('evm_snapshot', []);

                let aliceLPTokenBefore1 = await uniswapV2PairInstance.balanceOf(alice.address);
                let aliceReservedTokenBefore1 = await erc20ReservedToken.balanceOf(alice.address);
                let aliceTradedTokenBefore1 = await erc20TradedToken.balanceOf(alice.address);

                await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);
                await CommunityCoin.connect(alice)["redeem(uint256)"](shares);

                let aliceLPTokenAfter1 = await uniswapV2PairInstance.balanceOf(alice.address);
                let aliceReservedTokenAfter1 = await erc20ReservedToken.balanceOf(alice.address);
                let aliceTradedTokenAfter1 = await erc20TradedToken.balanceOf(alice.address);
                
                expect(aliceLPTokenAfter1).gt(aliceLPTokenBefore1);
                expect(aliceReservedTokenAfter1).eq(aliceReservedTokenBefore1);
                expect(aliceTradedTokenAfter1).eq(aliceTradedTokenBefore1);

                aliceLPTokenWithoutTariff = aliceLPTokenAfter1.sub(aliceLPTokenBefore1)
                // restore snapshot
                await ethers.provider.send('evm_revert', [snapId]);
                //----------------------------------------------------------------
                // make snapshot before time manipulations
                snapId = await ethers.provider.send('evm_snapshot', []);

                await mockCommunity.connect(owner).setRoles(charlie.address, [TARIFF_ROLE]);
                await CommunityCoin.connect(charlie).setTariff(MAX_REDEEM_TARIFF, ONE);

                let aliceLPTokenBefore2 = await uniswapV2PairInstance.balanceOf(alice.address);
                let aliceReservedTokenBefore2 = await erc20ReservedToken.balanceOf(alice.address);
                let aliceTradedTokenBefore2 = await erc20TradedToken.balanceOf(alice.address);

                await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);
                await CommunityCoin.connect(alice)["redeem(uint256)"](shares);

                let aliceLPTokenAfter2 = await uniswapV2PairInstance.balanceOf(alice.address);
                let aliceReservedTokenAfter2 = await erc20ReservedToken.balanceOf(alice.address);
                let aliceTradedTokenAfter2 = await erc20TradedToken.balanceOf(alice.address);
                
                expect(aliceLPTokenAfter2).gt(aliceLPTokenBefore2);
                expect(aliceReservedTokenAfter2).eq(aliceReservedTokenBefore2);
                expect(aliceTradedTokenAfter2).eq(aliceTradedTokenBefore2);

                aliceLPTokenWithTariff = aliceLPTokenAfter2.sub(aliceLPTokenBefore2)

                // restore snapshot
                await ethers.provider.send('evm_revert', [snapId]);

                // now check redeem tariff
                expect(aliceLPTokenWithTariff).to.be.eq(aliceLPTokenWithoutTariff.sub(aliceLPTokenWithoutTariff.mul(MAX_REDEEM_TARIFF).div(FRACTION)));
            });
        });
        
    });

    describe("donate tests", function () {   
        var uniswapRouterFactoryInstance;
        var uniswapRouterInstance;
        var communityStakingPool;
        var pairInstance;
        
        const DONATIONS = [[david.address, FRACTION*50/100], [frank.address, FRACTION*25/100]];
        beforeEach("deploying", async() => {
        
            uniswapRouterFactoryInstance = await ethers.getContractAt("IUniswapV2Factory",UNISWAP_ROUTER_FACTORY_ADDRESS);
            uniswapRouterInstance = await ethers.getContractAt("IUniswapV2Router02", UNISWAP_ROUTER);

            await uniswapRouterFactoryInstance.createPair(erc20ReservedToken.address, erc20TradedToken.address);
        
            let pairAddress = await uniswapRouterFactoryInstance.getPair(erc20ReservedToken.address, erc20TradedToken.address);

            pairInstance = await ethers.getContractAt("ERC20Mintable",pairAddress);

            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));

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

            let tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            )

            const rc = await tx.wait(); // 0ms, as tx is already confirmed
            const event = rc.events.find(event => event.event === 'InstanceCreated');
            const [tokenA, tokenB, instance] = event.args;
            //console.log(tokenA, tokenB, instance, instancesCount);

            communityStakingPool = await ethers.getContractAt("MockCommunityStakingPool",instance);
            //console.log("before each №2");

            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));

            const ts2 = await time.latest();
            const timeUntil2 = parseInt(ts2)+parseInt(lockupIntervalCount*dayInSeconds);

            await uniswapRouterInstance.connect(liquidityHolder).addLiquidityETH(
                erc20ReservedToken.address,
                ONE_ETH.mul(TEN),
                0,
                0,
                liquidityHolder.address,
                timeUntil2,
                {value: ONE_ETH.mul(TEN) }
            );
        });

        it("buyAddLiquidityAndStake (donations:50% and 25%. left for sender)", async () => {
            
            await communityStakingPool.connect(bob)['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
            
            let bobWalletTokens = await CommunityCoin.balanceOf(bob.address);
            let poolLptokens = await pairInstance.balanceOf(communityStakingPool.address);

            let davidWalletTokens = await CommunityCoin.balanceOf(david.address);
            let frankWalletTokens = await CommunityCoin.balanceOf(frank.address);

            expect(bobWalletTokens).not.to.be.eq(ZERO);
            expect(davidWalletTokens).not.to.be.eq(ZERO);
            expect(frankWalletTokens).not.to.be.eq(ZERO);

            expect(poolLptokens).not.to.be.eq(ZERO);
            expect(
                poolLptokens.mul(numerator).div(denominator).div(10).mul(10)
            ).to.be.eq(
                davidWalletTokens.add(frankWalletTokens).add(bobWalletTokens).div(10).mul(10)
            );

            // donates 50% and 25% and left for Bob
            expect(davidWalletTokens).to.be.eq(frankWalletTokens.add(bobWalletTokens));
            
        });  

    });

    describe("Snapshots tests", function () {
        var uniswapRouterFactoryInstance;
        var uniswapRouterInstance;
        var communityStakingPool;
        var communityStakingPoolBonus;
        var pairInstance;

        var func;
        var tmp;

        beforeEach("deploying", async() => {
        
            uniswapRouterFactoryInstance = await ethers.getContractAt("IUniswapV2Factory",UNISWAP_ROUTER_FACTORY_ADDRESS);
            uniswapRouterInstance = await ethers.getContractAt("IUniswapV2Router02", UNISWAP_ROUTER);

            await uniswapRouterFactoryInstance.createPair(erc20ReservedToken.address, erc20TradedToken.address);
        
            let pairAddress = await uniswapRouterFactoryInstance.getPair(erc20ReservedToken.address, erc20TradedToken.address);

            pairInstance = await ethers.getContractAt("ERC20Mintable",pairAddress);

            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));

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

            func = async (param_bonus_fractions, lp_fraction, lp_fraction_beneficiary) => {
                
                let tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                    lockupIntervalCount,
                    param_bonus_fractions,
                    NO_DONATIONS,
                    lp_fraction,
                    lp_fraction_beneficiary,
                    rewardsRateFraction,
                    numerator,
                    denominator
                )

                const rc = await tx.wait(); // 0ms, as tx is already confirmed
                const event = rc.events.find(event => event.event === 'InstanceCreated');
                const [tokenA, tokenB, instance] = event.args;
                //console.log(tokenA, tokenB, instance, instancesCount);

                communityStakingPool = await ethers.getContractAt("MockCommunityStakingPool",instance);
                //console.log("before each №2");

                await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN));
                await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));

                const ts2 = await time.latest();
                const timeUntil2 = parseInt(ts2)+parseInt(lockupIntervalCount*dayInSeconds);

                await uniswapRouterInstance.connect(liquidityHolder).addLiquidityETH(
                    erc20ReservedToken.address,
                    ONE_ETH.mul(TEN),
                    0,
                    0,
                    liquidityHolder.address,
                    timeUntil2,
                    {value: ONE_ETH.mul(TEN) }
                );
                
                //--------------------------------------------------------
                await communityStakingPool.connect(bob)['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
                let bobWalletTokens = await CommunityCoin.balanceOf(bob.address);

                return bobWalletTokens;
            }
            
        });

        it("cover for cover", async () => {
            let snapId, tx, rc,event,tokenA, tokenB, instance;
            // get WETH adddress from another instnance
            snapId = await ethers.provider.send('evm_snapshot', []);

            // cover for covered one case. When reserved token is WETH and we send ETH directly to buyAndStakeLiquidity
            tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                ZERO, //lp_fraction,
                ZERO_ADDRESS, //lp_fraction_beneficiary,
                rewardsRateFraction,
                numerator,
                denominator
            )

            rc = await tx.wait(); // 0ms, as tx is already confirmed
            event = rc.events.find(event => event.event === 'InstanceCreated');
            [tokenA, tokenB, instance] = event.args;

            communityStakingPool = await ethers.getContractAt("MockCommunityStakingPool",instance);
            const WETH = await ethers.getContractAt("MockIWETH", await communityStakingPool.WETH());
            await ethers.provider.send('evm_revert', [snapId]);

            ///----
            snapId = await ethers.provider.send('evm_snapshot', []);

            uniswapRouterFactoryInstance = await ethers.getContractAt("IUniswapV2Factory",UNISWAP_ROUTER_FACTORY_ADDRESS);
            uniswapRouterInstance = await ethers.getContractAt("IUniswapV2Router02", UNISWAP_ROUTER);

            await uniswapRouterFactoryInstance.createPair(WETH.address, erc20TradedToken.address);
        
            let pairAddress = await uniswapRouterFactoryInstance.getPair(erc20ReservedToken.address, erc20TradedToken.address);

            pairInstance = await ethers.getContractAt("ERC20Mintable",pairAddress);
            
            await WETH.connect(liquidityHolder).deposit({value: ONE_ETH.mul(TEN) });
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(TEN));
            await WETH.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(TEN));

            const ts = await time.latest();
            const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                WETH.address,
                erc20TradedToken.address,
                ONE_ETH.mul(SEVEN),
                ONE_ETH.mul(SEVEN),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );
            // without hook
            tx = await CommunityCoinFactory.connect(owner).produce(WETH.address, erc20TradedToken.address, ZERO_ADDRESS, discountSensitivity, [
                INVITEDBY_FRACTION,
                mockCommunity.address, 
                REDEEM_ROLE, 
                CIRCULATE_ROLE,
                TARIFF_ROLE
            ]);
            rc = await tx.wait(); // 0ms, as tx is already confirmed
            event = rc.events.find(event => event.event === 'InstanceCreated');
            [instance, instancesCount] = event.args;
            CommunityCoin = await ethers.getContractAt("CommunityCoin",instance);

            // cover for covered one case. When reserved token is WETH and we send ETH directly to buyAndStakeLiquidity
            tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                ZERO, //lp_fraction,
                ZERO_ADDRESS, //lp_fraction_beneficiary,
                rewardsRateFraction,
                numerator,
                denominator
            )
            
            rc = await tx.wait(); // 0ms, as tx is already confirmed
            event = rc.events.find(event => event.event === 'InstanceCreated');
            [tokenA, tokenB, instance] = event.args;
            //console.log(tokenA, tokenB, instance, instancesCount);

            communityStakingPool = await ethers.getContractAt("MockCommunityStakingPool",instance);

            //--------------------------------------------------------
            // console.log(await CommunityCoin.balanceOf(bob.address));
            await communityStakingPool.connect(bob)['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
            // console.log(await CommunityCoin.balanceOf(bob.address));


        });

        it("Bonus tests::buyAddLiquidityAndStake (Bonus:50%)", async () => {

            // here we: 
            // - calculate how much tokens user will obtain without bonuses 
            // - store them in `tokensWithNoBonus`
            // - revert snapshot
            // - calculate how much tokens user will obtain WITH bonuses (50%)
            // - store them in `tokensWithBonus`
            // - validate that bonus token shouldn't be unstaked even if duration pass
            // - validate that bonus token can be transfer and consuming in first order


            let snapId;

            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);
            let tokensWithNoBonus = await func(NO_BONUS_FRACTIONS, ZERO, ZERO_ADDRESS);

            await expect(CommunityCoin.connect(bob)["unstake(uint256)"](tokensWithNoBonus)).to.be.revertedWith(`StakeNotUnlockedYet("${bob.address}", ${tokensWithNoBonus}, 0)`);
            

            // pass some mtime
            await time.increase(lockupIntervalCount*dayInSeconds+9);    

            await CommunityCoin.connect(bob).approve(CommunityCoin.address, tokensWithNoBonus);
            await CommunityCoin.connect(bob)["unstake(uint256)"](tokensWithNoBonus);

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
            //--------------------------------------------------------------
            snapId = await ethers.provider.send('evm_snapshot', []);
            let tokensWithBonus = await func(BONUS_FRACTIONS, ZERO, ZERO_ADDRESS);

            await expect(CommunityCoin.connect(bob)["unstake(uint256)"](tokensWithNoBonus)).to.be.revertedWith(`StakeNotUnlockedYet("${bob.address}", ${tokensWithNoBonus}, ${tokensWithNoBonus.div(TWO)})`);
            await expect(CommunityCoin.connect(bob)["unstake(uint256)"](tokensWithBonus)).to.be.revertedWith(`StakeNotUnlockedYet("${bob.address}", ${tokensWithNoBonus}, 0)`);

            ////// validate `viewLockedWalletTokens` and `viewLockedWalletTokensList`
            let bobSharesAfter = await CommunityCoin.balanceOf(bob.address);
            let bobLockedListAfter, bobBonusesListAfter;

            let bobLockedBalanceAfter = await CommunityCoin.connect(bob).viewLockedWalletTokens(bob.address);
            [bobLockedListAfter, bobBonusesListAfter] = await CommunityCoin.connect(bob).viewLockedWalletTokensList(bob.address);

            expect(bobLockedBalanceAfter).to.be.eq(bobSharesAfter);
            expect(bobLockedBalanceAfter).to.be.eq(tokensWithBonus);

            expect(tokensWithNoBonus).to.be.eq(bobLockedListAfter[0][0]);
            expect(tokensWithBonus.sub(tokensWithNoBonus)).to.be.eq(bobBonusesListAfter[0][0]);
            ////// ENDOF validate `viewLockedWalletTokens` and `viewLockedWalletTokensList`
            
            // pass some mtime
            await time.increase(lockupIntervalCount*dayInSeconds+9);    

            await CommunityCoin.connect(bob).approve(CommunityCoin.address, tokensWithBonus);

            await expect(CommunityCoin.connect(bob)["unstake(uint256)"](tokensWithBonus)).to.be.revertedWith(`InsufficientAmount("${bob.address}", ${tokensWithBonus})`);

            await CommunityCoin.connect(bob).transfer(alice.address, tokensWithBonus.sub(tokensWithNoBonus));

            await CommunityCoin.connect(bob).approve(CommunityCoin.address, tokensWithNoBonus);
            await CommunityCoin.connect(bob)["unstake(uint256)"](tokensWithNoBonus);

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);

            // finally check correct amount of bonuses
            let expectedBonusAmount = tokensWithNoBonus.mul(BONUS_FRACTIONS).div(FRACTION);
            expect(tokensWithBonus).to.be.eq(tokensWithNoBonus.add(expectedBonusAmount));

        });  

        it("(LP Fraction:50%)", async () => {
            // checking lpfraction (how much tokens will consuming when user unstake/redeem)
            // actually need to 
            // -- calculate how much will return with LPFraction=0;
            // -- make snapshot revert and do the same with LPFraction=50%
            // -- lp tokens should be less in 2 times.
            // but we can do it in one cycle. keep in mind that did no any actions before and numerator/denominator are 1:1
            // in that cases for first transaction lp tokens should be less in 2 times too.
            
            let snapId;

            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);

            let lpFraction = 50000; // 50%
            let shares = await func(NO_BONUS_FRACTIONS, lpFraction, ZERO_ADDRESS);

            // pass some mtime
            await time.increase(lockupIntervalCount*dayInSeconds+9);    
            
            let lpTokensBefore = await pairInstance.balanceOf(bob.address);
            await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);
            await CommunityCoin.connect(bob)["unstake(uint256)"](shares);
            let lpTokensAfter = await pairInstance.balanceOf(bob.address);

            // numerator/denominator are 1:1
            expect(lpTokensAfter.sub(lpTokensBefore)).to.be.eq(shares.sub(shares.mul(lpFraction).div(FRACTION)));

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
        });  

        it("(LP Fraction:100%)", async () => {
            // custom situation when lpfraction is 100%, user will no obtain LP. [but it's no donation]

            let snapId;
            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);

            let lpFraction = FRACTION; // 100%
            let shares = await func(NO_BONUS_FRACTIONS, lpFraction, ZERO_ADDRESS);

            // pass some mtime
            await time.increase(lockupIntervalCount*dayInSeconds+9);    
            
            let lpTokensBefore = await pairInstance.balanceOf(bob.address);
            await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);
            await CommunityCoin.connect(bob)["unstake(uint256)"](shares);
            let lpTokensAfter = await pairInstance.balanceOf(bob.address);

            // numerator/denominator are 1:1
            expect(lpTokensAfter.sub(lpTokensBefore)).to.be.eq(shares.sub(shares.mul(lpFraction).div(FRACTION)));

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
        });  

        it("(LP Fraction:50%) redeemAndRemoveLiquidity", async () => {

            //uint64 public constant FRACTION = 100000;
            let snapId;

            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);

            let lpFraction = 50000; // 50%
            
            let charlieLPTokensWithNoLPConsumingBefore = await pairInstance.connect(charlie).balanceOf(charlie.address);
            let charlieErc20ReservedTokensWithNoLPConsumingBefore = await erc20ReservedToken.balanceOf(charlie.address);
            
            let tokensWithNoLPConsuming = await func(NO_BONUS_FRACTIONS, ZERO, ZERO_ADDRESS);

            // // pass some mtime
            // await time.increase(lockupIntervalCount*dayInSeconds+9);  

            // grant role
            // imitate exists role
            await mockCommunity.connect(owner).setRoles(charlie.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);

            // transfer to charlie who has redeem role
            //console.log(":JS1");
            await CommunityCoin.connect(bob).transfer(charlie.address, tokensWithNoLPConsuming);
            //console.log(":JS2");

            await CommunityCoin.connect(charlie).approve(CommunityCoin.address, tokensWithNoLPConsuming);
            await CommunityCoin.connect(charlie)["redeemAndRemoveLiquidity(uint256)"](tokensWithNoLPConsuming);  

            let charlieErc20ReservedTokensWithNoLPConsumingAfter = await erc20ReservedToken.balanceOf(charlie.address);
            let charlieLPTokensWithNoLPConsumingAfter = await pairInstance.connect(charlie).balanceOf(charlie.address);

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
            //------------------------------------------------------------------------------
            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);

            let charlieLPTokensWithLPConsumingBefore = await pairInstance.connect(charlie).balanceOf(charlie.address);
            let charlieErc20ReservedTokensWithLPConsumingBefore = await erc20ReservedToken.balanceOf(charlie.address);
            let tokensWithLPConsuming = await func(NO_BONUS_FRACTIONS, lpFraction, alice.address); // lp = 1%

            // // pass some mtime
            // await time.increase(lockupIntervalCount*dayInSeconds+9);  
            // grant role
            // imitate exists role
            await mockCommunity.connect(owner).setRoles(charlie.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);

            // transfer to charlie who has redeem role
            await CommunityCoin.connect(bob).transfer(charlie.address, tokensWithLPConsuming);

            await CommunityCoin.connect(charlie).approve(CommunityCoin.address, tokensWithLPConsuming);
            await CommunityCoin.connect(charlie)["redeemAndRemoveLiquidity(uint256)"](tokensWithLPConsuming);  

            let charlieLPTokensWithLPConsumingAfter = await pairInstance.connect(charlie).balanceOf(charlie.address);
            let charlieErc20ReservedTokensWithLPConsumingAfter = await erc20ReservedToken.balanceOf(charlie.address);


            let diffWithNoLPConsuming = charlieErc20ReservedTokensWithNoLPConsumingAfter.sub(charlieErc20ReservedTokensWithNoLPConsumingBefore);
            let diffWithLPConsuming = charlieErc20ReservedTokensWithLPConsumingAfter.sub(charlieErc20ReservedTokensWithLPConsumingBefore);

            expect(diffWithNoLPConsuming).to.be.gt(diffWithLPConsuming);
            expect(diffWithNoLPConsuming.sub(diffWithNoLPConsuming.mul(lpFraction).div(FRACTION))).to.be.eq(diffWithLPConsuming);


            expect(
                charlieLPTokensWithNoLPConsumingAfter.sub(charlieLPTokensWithNoLPConsumingBefore)
            ).to.be.eq(
                charlieLPTokensWithLPConsumingAfter.sub(charlieLPTokensWithLPConsumingBefore)
            );

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
        });  


        it("InvitedBy tests", async () => {
            let snapId, bobTokens, aliceTokens;

            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);

            await func(NO_BONUS_FRACTIONS, ZERO, ZERO_ADDRESS);
            bobTokens = await CommunityCoin.balanceOf(bob.address);
            aliceTokens = await CommunityCoin.balanceOf(alice.address);

            expect(bobTokens).not.to.be.eq(aliceTokens);

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);

            await CommunityCoin.connect(owner).setCommission(FRACTION);
            await mockCommunity.setInvitedBy(alice.address, bob.address);
            
            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);
            await func(NO_BONUS_FRACTIONS, ZERO, ZERO_ADDRESS);

            bobTokens = await CommunityCoin.balanceOf(bob.address);
            aliceTokens = await CommunityCoin.balanceOf(alice.address);

            expect(bobTokens).to.be.eq(aliceTokens); // invitedBy - 100%

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
        });  

        it("LP Fraction validate", async () => {
            
            //uint64 public constant FRACTION = 100000;
            let snapId;

            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);
            let charlieLPTokensWithNoLPConsumingBefore = await pairInstance.connect(charlie).balanceOf(charlie.address);
            let tokensWithNoLPConsuming = await func(NO_BONUS_FRACTIONS, ZERO, ZERO_ADDRESS);

            // // pass some mtime
            // await time.increase(lockupIntervalCount*dayInSeconds+9);  

            // grant role
            // imitate exists role
            await mockCommunity.connect(owner).setRoles(charlie.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);

            // transfer to charlie who has redeem role
            //console.log(":JS1");
            await CommunityCoin.connect(bob).transfer(charlie.address, tokensWithNoLPConsuming);
            //console.log(":JS2");

            await CommunityCoin.connect(charlie).approve(CommunityCoin.address, tokensWithNoLPConsuming);
            await CommunityCoin.connect(charlie)["redeem(uint256)"](tokensWithNoLPConsuming);  

            let charlieLPTokensWithNoLPConsumingAfter = await pairInstance.connect(charlie).balanceOf(charlie.address);

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
            //------------------------------------------------------------------------------
            // make snapshot before time manipulations
            snapId = await ethers.provider.send('evm_snapshot', []);

            let aliceLPTokensWithLPConsumingBefore = await pairInstance.connect(alice).balanceOf(alice.address);
            let charlieLPTokensWithLPConsumingBefore = await pairInstance.connect(charlie).balanceOf(charlie.address);
            let tokensWithLPConsuming = await func(NO_BONUS_FRACTIONS, 1000, alice.address); // lp = 1%

            // // pass some mtime
            // await time.increase(lockupIntervalCount*dayInSeconds+9);  
            // grant role
            // imitate exists role
            await mockCommunity.connect(owner).setRoles(charlie.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);

            // transfer to charlie who has redeem role
            await CommunityCoin.connect(bob).transfer(charlie.address, tokensWithLPConsuming);

            await CommunityCoin.connect(charlie).approve(CommunityCoin.address, tokensWithLPConsuming);
            await CommunityCoin.connect(charlie)["redeem(uint256)"](tokensWithLPConsuming);  

            let aliceLPTokensWithLPConsumingAfter = await pairInstance.connect(alice).balanceOf(alice.address);
            let charlieLPTokensWithLPConsumingAfter = await pairInstance.connect(charlie).balanceOf(charlie.address);

            expect(
                charlieLPTokensWithNoLPConsumingAfter.sub(charlieLPTokensWithNoLPConsumingBefore)
            ).to.be.gt(
                charlieLPTokensWithLPConsumingAfter.sub(charlieLPTokensWithLPConsumingBefore)
            );

            expect(
                charlieLPTokensWithNoLPConsumingAfter.sub(charlieLPTokensWithLPConsumingAfter)
            ).to.be.eq(
                aliceLPTokensWithLPConsumingAfter.sub(aliceLPTokensWithLPConsumingBefore)
            );

            // restore snapshot
            await ethers.provider.send('evm_revert', [snapId]);
        });  
    });

    describe("TrustedForwarder Rewards", function () {

        var rewards;
        
        const DONATIONS = [[david.address, FRACTION*50/100], [frank.address, FRACTION*25/100]];
        beforeEach("deploying", async() => {

            const RewardsF = await ethers.getContractFactory("Rewards");
            rewards = await RewardsF.deploy();
            await rewards.initialize(
                frank.address, //address sellingToken,
                [], //uint256[] memory timestamps,
                [], //uint256[] memory prices,
                [], //uint256[] memory thresholds,
                [], //uint256[] memory bonuses
            );

        });

        it("should be empty after init", async() => {
            expect(await rewards.connect(bob).isTrustedForwarder(ZERO_ADDRESS)).to.be.true;
            
        });

        it("should be setup by owner", async() => {
            await expect(rewards.connect(bob).setTrustedForwarder(charlie.address)).to.be.revertedWith("Ownable: caller is not the owner");
            expect(await rewards.connect(bob).isTrustedForwarder(ZERO_ADDRESS)).to.be.true;
            await rewards.connect(owner).setTrustedForwarder(charlie.address);
            expect(await rewards.connect(bob).isTrustedForwarder(charlie.address)).to.be.true;
        });
        
        it("should drop trusted forward if trusted forward become owner ", async() => {
            await rewards.connect(owner).setTrustedForwarder(charlie.address);
            expect(await rewards.connect(bob).isTrustedForwarder(charlie.address)).to.be.true;
            await rewards.connect(owner).transferOwnership(charlie.address);
            expect(await rewards.connect(bob).isTrustedForwarder(ZERO_ADDRESS)).to.be.true;
        });

        it("shouldnt become owner and trusted forwarder", async() => {
            await expect(rewards.connect(owner).setTrustedForwarder(owner.address)).to.be.revertedWith("FORWARDER_CAN_NOT_BE_OWNER");
        });

    });

    describe("Rewards tests", function () {   
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

            let tx = await CommunityCoinWithRewardsHook.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
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

        it("test rewards tokens", async() => {
            const GroupName = "TestGroup";
          
            await rewardsHook.connect(owner).setGroup([bob.address], GroupName);
            const oldGroupBonus = await rewardsHook.getGroupBonus(GroupName);
            await expect(oldGroupBonus).to.be.eq(ZERO);

            await communityStakingPoolWithHook.connect(bob)['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
            let shares = await CommunityCoinWithRewardsHook.balanceOf(bob.address);

            // pass some mtime
            await time.increase(lockupIntervalCount*dayInSeconds+9);    

            await CommunityCoinWithRewardsHook.connect(bob).approve(CommunityCoinWithRewardsHook.address, shares);
            await CommunityCoinWithRewardsHook.connect(bob)["unstakeAndRemoveLiquidity(uint256)"](shares);

            const newGroupBonus = await rewardsHook.getGroupBonus(GroupName);
            expect(newGroupBonus).not.to.be.eq(ZERO);
            expect(newGroupBonus).to.be.eq(rewardsTenPercentBonus);

            await expect(CommunityCoinWithRewardsHook.connect(bob).claim()).to.be.revertedWith('Amount exceeds allowed balance');

            await erc20Reward.mint(rewardsHook.address, HUNDRED.mul(ONE_ETH));
            let oldBobBalance = await erc20Reward.balanceOf(bob.address);
            await CommunityCoinWithRewardsHook.connect(bob).claim();
            let newBobBalance = await erc20Reward.balanceOf(bob.address);
            expect(newBobBalance).to.be.gt(oldBobBalance);

        });
    });

    describe("Taxes tests", function () {   
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

            let tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
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

        describe("test transferHook ", function () {   
            var taxHook;
            beforeEach("before each", async() => {
                await communityStakingPoolWithHook.connect(bob)['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
                
                walletTokens = await CommunityCoin.balanceOf(bob.address);
                lptokens = await pairInstance.balanceOf(communityStakingPoolWithHook.address);

                const MockTaxesF = await ethers.getContractFactory("MockTaxes");
                taxHook = await MockTaxesF.deploy();
                
                await CommunityCoin.connect(owner).setupTaxAddress(taxHook.address);
                

            }); 

            it("should prevent transfer if disabled via hook contract", async() => {
                
                // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                expect(lptokens).not.to.be.eq(ZERO);
                expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;

                await taxHook.setupVars(ZERO,false);

                await expect(CommunityCoin.connect(bob).transfer(alice.address, walletTokens)).to.be.revertedWith(`HookTransferPrevent("${bob.address}", "${alice.address}", ${walletTokens})`);
                
            });

            it("should allow transfer if enabled via hook contract", async() => {
                
                // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                expect(lptokens).not.to.be.eq(ZERO);
                expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;

                await taxHook.setupVars(FRACTION,true);

                await expect(CommunityCoin.connect(bob).transfer(alice.address, walletTokens)).not.to.be.revertedWith(`HookTransferPrevent("${bob.address}", "${alice.address}", ${walletTokens})`);
                
            });

            describe("test taxes ", function () {   
                let tmp1,tmp2,tmp3,tmp4;
                let obtainedTokensWithNoTax, obtainedTokensWithTax, senderTokensWithNoTax, senderTokensTokensWithTax;

                const TokensToSend = ONE_ETH.div(20);
                const PERCENTS_FRACTION = FIVE.mul(FRACTION).div(100); //5%*fraction

                beforeEach("before each", async() => {
                    await taxHook.setupVars(FRACTION,true);
                    tmp1 = await CommunityCoin.balanceOf(alice.address);
                    tmp3 = await CommunityCoin.balanceOf(bob.address);
                    await CommunityCoin.connect(bob).transfer(alice.address, TokensToSend);
                    tmp2 = await CommunityCoin.balanceOf(alice.address);
                    tmp4 = await CommunityCoin.balanceOf(bob.address);

                    obtainedTokensWithNoTax = tmp2.sub(tmp1);
                    senderTokensWithNoTax = tmp3.sub(tmp4);
                    
                });
                it("should reduce tokens while transfer if taxes used", async() => {

                    tmp1 = await CommunityCoin.balanceOf(alice.address);
                    await taxHook.setupVars(FRACTION.sub(PERCENTS_FRACTION), true);
                    await CommunityCoin.connect(bob).transfer(alice.address, TokensToSend);
                    tmp2 = await CommunityCoin.balanceOf(alice.address);

                    obtainedTokensWithTax = tmp2.sub(tmp1);

                    expect(obtainedTokensWithTax).to.be.lt(obtainedTokensWithNoTax);

                    expect(obtainedTokensWithNoTax.sub(obtainedTokensWithNoTax.mul(PERCENTS_FRACTION).div(FRACTION))).to.be.eq(obtainedTokensWithTax);
                    
                });

                it("shouldn't exceed maxTAX ", async() => {
                    
                    const TOO_MUCH_PERCENTS_FRACTION = HUNDRED.mul(FRACTION).div(100); //100%*fraction
                    
                    tmp1 = await CommunityCoin.balanceOf(alice.address);
                    await taxHook.setupVars(FRACTION.sub(TOO_MUCH_PERCENTS_FRACTION), true);
                    await CommunityCoin.connect(bob).transfer(alice.address, TokensToSend);
                    tmp2 = await CommunityCoin.balanceOf(alice.address);

                    obtainedTokensWithTax = tmp2.sub(tmp1);

                    expect(obtainedTokensWithTax).to.be.lt(obtainedTokensWithNoTax);

                    expect(obtainedTokensWithNoTax.sub(obtainedTokensWithNoTax.mul(PERCENTS_FRACTION).div(FRACTION))).not.to.be.eq(obtainedTokensWithTax);

                    let MAX_TAX = await await CommunityCoin.MAX_TAX();
                    expect(obtainedTokensWithNoTax.sub(obtainedTokensWithNoTax.mul(MAX_TAX).div(FRACTION))).to.be.eq(obtainedTokensWithTax);
                    
                });

                it("should mint extra tokens while transfer if taxes used ", async() => {
                    tmp1 = await CommunityCoin.balanceOf(alice.address);
                    await taxHook.setupVars(FRACTION.add(PERCENTS_FRACTION), true);
                    await CommunityCoin.connect(bob).transfer(alice.address, TokensToSend);
                    tmp2 = await CommunityCoin.balanceOf(alice.address);

                    obtainedTokensWithTax = tmp2.sub(tmp1);

                    expect(obtainedTokensWithTax).to.be.gt(obtainedTokensWithNoTax);

                    expect(obtainedTokensWithNoTax.add(obtainedTokensWithNoTax.mul(PERCENTS_FRACTION).div(FRACTION))).to.be.eq(obtainedTokensWithTax);
                });
                
                it("shouldn't exceed maxBOOST", async() => {
                     
                    const TOO_MUCH_PERCENTS_FRACTION = HUNDRED.mul(FRACTION).div(100); //100%*fraction
                    
                    tmp1 = await CommunityCoin.balanceOf(alice.address);
                    await taxHook.setupVars(FRACTION.add(TOO_MUCH_PERCENTS_FRACTION), true);
                    await CommunityCoin.connect(bob).transfer(alice.address, TokensToSend);
                    tmp2 = await CommunityCoin.balanceOf(alice.address);

                    obtainedTokensWithTax = tmp2.sub(tmp1);

                    expect(obtainedTokensWithTax).to.be.gt(obtainedTokensWithNoTax);

                    expect(obtainedTokensWithNoTax.add(obtainedTokensWithNoTax.mul(PERCENTS_FRACTION).div(FRACTION))).not.to.be.eq(obtainedTokensWithTax);

                    let MAX_BOOST = await await CommunityCoin.MAX_BOOST();
                    expect(obtainedTokensWithNoTax.add(obtainedTokensWithNoTax.mul(MAX_BOOST).div(FRACTION))).to.be.eq(obtainedTokensWithTax);
                });
            });
           
        }); 

    });

    describe("ERC20 pool tests", function () { 
        var communityStakingPoolErc20; 
        beforeEach("deploying", async() => { 
            let tx = await CommunityCoin.connect(owner)["produce(address,uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                erc20.address,
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            );

            const rc = await tx.wait(); // 0ms, as tx is already confirmed
            const event = rc.events.find(event => event.event === 'InstanceErc20Created');
            const [erc20tokenAddress, instance] = event.args;
            
            communityStakingPoolErc20 = await ethers.getContractAt("CommunityStakingPoolErc20",instance);
        });
        it("should produce", async() => {
            expect(communityStakingPoolErc20.address).not.to.be.eq(ZERO_ADDRESS); 
        });

        it("shouldn't receive ether", async() => {
            await expect(
                owner.sendTransaction({
                    to: communityStakingPoolErc20.address,
                    value: ethers.utils.parseEther("1.0"), // Sends exactly 1.0 ether
                })
            ).not.to.be.revertedWith("DENIED()"); 
        });
        
        it("shouldnt create another pair with equal tokens", async() => {
            await expect(CommunityCoin["produce(address,uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                erc20.address,
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            )).to.be.revertedWith("CommunityCoin: PAIR_ALREADY_EXISTS");
        });

        it("shouldn't produce another instance type", async() => {
            
            await expect(CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            )).to.be.revertedWith("CommunityCoin: INVALID_INSTANCE_TYPE");

        });

        describe("buy and stake", function() {
            var uniswapRouterFactoryInstance;
            var uniswapRouterInstance;

            var bobWalletTokensBefore, charlieWalletTokensBefore, charlieWalletTokensAfter, bobWalletTokensAfter;

            beforeEach("deploying", async() => {
                uniswapRouterFactoryInstance = await ethers.getContractAt("IUniswapV2Factory",UNISWAP_ROUTER_FACTORY_ADDRESS);
                uniswapRouterInstance = await ethers.getContractAt("IUniswapV2Router02", UNISWAP_ROUTER);

                await uniswapRouterFactoryInstance.createPair(erc20.address, erc20TradedToken.address);
            
                let pairAddress = await uniswapRouterFactoryInstance.getPair(erc20.address, erc20TradedToken.address);

                pairInstance = await ethers.getContractAt("ERC20Mintable",pairAddress);

                await erc20.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
                await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(SEVEN));
                await erc20.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));
                await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(SEVEN));

                const ts = await time.latest();
                const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

                await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                    erc20.address,
                    erc20TradedToken.address,
                    ONE_ETH.mul(SEVEN),
                    ONE_ETH.mul(SEVEN),
                    0,
                    0,
                    liquidityHolder.address,
                    timeUntil
                );

                charlieWalletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                bobWalletTokensBefore = await CommunityCoin.balanceOf(bob.address);

                
                await erc20TradedToken.mint(bob.address, ONE_ETH.mul(ONE));
                await erc20TradedToken.connect(bob).approve(communityStakingPoolErc20.address, ONE_ETH.mul(ONE));
                
                await communityStakingPoolErc20.connect(bob).buyAndStake(erc20TradedToken.address, ONE_ETH.mul(ONE), charlie.address);

                charlieWalletTokensAfter = await CommunityCoin.balanceOf(charlie.address);
                bobWalletTokensAfter = await CommunityCoin.balanceOf(bob.address);
            })

            it("just stake", async () => {

                await erc20.mint(bob.address, ONE_ETH.mul(ONE));
                await erc20.connect(bob).approve(communityStakingPoolErc20.address, ONE_ETH.mul(ONE));

                let charlieWalletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                let bobLptokensBefore = await erc20.balanceOf(communityStakingPoolErc20.address);

                await communityStakingPoolErc20.connect(bob).stake(ONE_ETH.mul(ONE), charlie.address);

                let walletTokens = await CommunityCoin.balanceOf(charlie.address);
                let lptokens = await erc20.balanceOf(communityStakingPoolErc20.address);
                
                // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                expect(BigNumber.from(lptokens)).not.to.be.eq(ZERO);
                expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);

                expect(charlieWalletTokensBefore).not.to.be.eq(walletTokens);
                expect(ZERO).not.to.be.eq(walletTokens);

                expect(bobLptokensBefore).not.to.be.eq(lptokens);
            
            }); 

            it("should buyAndStake", async () => {

                expect(charlieWalletTokensAfter).to.be.gt(charlieWalletTokensBefore);
                expect(charlieWalletTokensAfter).not.to.be.eq(ZERO);
            
            }); 

            it("shouldnt unstake if not unlocked yet", async () => {
                // even if approve before
                await CommunityCoin.connect(charlie).approve(CommunityCoin.address, charlieWalletTokensAfter);
                 
                await expect(CommunityCoin.connect(charlie).unstake(charlieWalletTokensAfter)).to.be.revertedWith(`StakeNotUnlockedYet("${charlie.address}", ${charlieWalletTokensAfter}, 0)`);
            });  

            it("shouldnt redeem if sender haven't redeem role", async () => {
                
                // even if approve before
                
                await CommunityCoin.connect(charlie).approve(CommunityCoin.address, charlieWalletTokensAfter);
                
                await expect(
                    CommunityCoin.connect(charlie)['redeem(uint256)'](charlieWalletTokensAfter)
                ).to.be.revertedWith(
                    `MissingRole("${charlie.address}", ${REDEEM_ROLE})`
                );
                
            }); 

            it("should transfer wallet tokens after stake", async() => {
            
                let charlieLockedListAfter, charlieBonusesListAfter;

                let charlieLockedBalanceAfter = await CommunityCoin.connect(charlie).viewLockedWalletTokens(charlie.address);
                [charlieLockedListAfter, charlieBonusesListAfter] = await CommunityCoin.connect(charlie).viewLockedWalletTokensList(charlie.address);

                let aliceLockedBalanceAfter = await CommunityCoin.connect(charlie).viewLockedWalletTokens(alice.address);
                expect(aliceLockedBalanceAfter).to.be.eq(ZERO);
                expect(charlieLockedBalanceAfter).to.be.eq(charlieWalletTokensAfter);
                expect(charlieLockedBalanceAfter).to.be.eq(charlieLockedListAfter[0][0]);

                await CommunityCoin.connect(charlie).transfer(alice.address, charlieWalletTokensAfter);

                let charlieSharesAfterTransfer = await CommunityCoin.balanceOf(charlie.address);
                let aliceSharesAfterCharlieTransfer = await CommunityCoin.balanceOf(alice.address);
                let charlieLockedBalanceAfterCharlieTransfer = await CommunityCoin.connect(charlie).viewLockedWalletTokens(charlie.address);
                let aliceLockedBalanceAfterCharlieTransfer = await CommunityCoin.connect(charlie).viewLockedWalletTokens(alice.address);

                expect(charlieSharesAfterTransfer).to.be.eq(ZERO);
                expect(charlieWalletTokensAfter).to.be.eq(aliceSharesAfterCharlieTransfer);
                expect(charlieLockedBalanceAfterCharlieTransfer).to.be.eq(ZERO);
                expect(aliceLockedBalanceAfterCharlieTransfer).to.be.eq(ZERO);
                
                
            });

            it("should redeem", async () => {
                // pass some mtime
                await time.increase(lockupIntervalCount*dayInSeconds+9);    

                // grant role
                // imitate exists role
                await mockCommunity.connect(owner).setRoles(alice.address, [REDEEM_ROLE]);

                // transfer from charlie to alice
                await CommunityCoin.connect(charlie).transfer(alice.address, charlieWalletTokensAfter);

                let aliceLPTokenBefore = await erc20.balanceOf(alice.address);

                await CommunityCoin.connect(alice).approve(CommunityCoin.address, charlieWalletTokensAfter);


                await CommunityCoin.connect(alice)['redeem(uint256)'](charlieWalletTokensAfter);
                let aliceLPTokenAfter = await erc20.balanceOf(alice.address);
                expect(aliceLPTokenAfter).gt(aliceLPTokenBefore);

            }); 


        })

    });

    describe(`Instance tests with external community`, function () {
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

            // add liquidity into erc20ReservedToken::USDT and erc20TradedToken::USDT
            fakeUSDT = await ERC20Factory.deploy("FAKE USDT Token", "FUSDT");
            await fakeUSDT.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED).mul(TWO));
            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));

            await fakeUSDT.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeUSDT.address,
                erc20TradedToken.address,
                ONE_ETH.mul(HUNDRED),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            await fakeUSDT.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeUSDT.address,
                erc20ReservedToken.address,
                ONE_ETH.mul(HUNDRED),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );
            // add liquidity into erc20ReservedToken::middleToken, erc20TradedToken::middleToken and middleToken::USDT
            fakeMiddle = await ERC20Factory.deploy("FAKE Middle Token", "FMT");

            await fakeMiddle.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED).mul(TEN));
            await erc20ReservedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));
            await erc20TradedToken.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));
            await fakeUSDT.mint(liquidityHolder.address, ONE_ETH.mul(HUNDRED));

            //erc20ReservedToken::middleToken
            await fakeMiddle.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED).mul(TWO));
            await erc20ReservedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeMiddle.address,
                erc20ReservedToken.address,
                ONE_ETH.mul(HUNDRED).mul(TWO),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            //erc20TradedToken::middleToken
            await fakeMiddle.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED).mul(TWO));
            await erc20TradedToken.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeMiddle.address,
                erc20TradedToken.address,
                ONE_ETH.mul(HUNDRED).mul(TWO),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            // middleToken::USDT
            await fakeMiddle.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED).mul(SIX));
            await fakeUSDT.connect(liquidityHolder).approve(uniswapRouterInstance.address, ONE_ETH.mul(HUNDRED));
            await uniswapRouterInstance.connect(liquidityHolder).addLiquidity(
                fakeMiddle.address,
                fakeUSDT.address,
                ONE_ETH.mul(HUNDRED).mul(SIX),
                ONE_ETH.mul(HUNDRED),
                0,
                0,
                liquidityHolder.address,
                timeUntil
            );

            //--------------------------------------------------

            let tx = await CommunityCoin.connect(owner)["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            )

            const rc = await tx.wait(); // 0ms, as tx is already confirmed
            const event = rc.events.find(event => event.event === 'InstanceCreated');
            const [tokenA, tokenB, instance] = event.args;
            //console.log(tokenA, tokenB, instance, instancesCount);

            communityStakingPool = await ethers.getContractAt("MockCommunityStakingPool",instance);
            //console.log("before each №2");

            
        });

        it("shouldnt create another pair with equal tokens", async() => {
            await expect(CommunityCoin["produce(uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            )).to.be.revertedWith("CommunityCoin: PAIR_ALREADY_EXISTS");
        });

        it("shouldn't produce another instance type", async() => {
          await expect(CommunityCoin["produce(address,uint64,uint64,(address,uint256)[],uint64,address,uint64,uint64,uint64)"](
                erc20.address,
                lockupIntervalCount,
                NO_BONUS_FRACTIONS,
                NO_DONATIONS,
                lpFraction,
                ZERO_ADDRESS,
                rewardsRateFraction,
                numerator,
                denominator
            )).to.be.revertedWith("CommunityCoin: INVALID_INSTANCE_TYPE");
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
                await expect(CommunityCoin.connect(owner).setTrustedForwarder(owner.address)).to.be.revertedWith(`TrustedForwarderCanNotBeOwner("${owner.address}")`);
            });
            
            it("shouldnt transferOwnership if sender is trusted forwarder", async() => {
                await CommunityCoin.connect(owner).setTrustedForwarder(trustedForwarder.address);

                const dataTx = await CommunityCoin.connect(trustedForwarder).populateTransaction['transferOwnership(address)'](bob.address);
                dataTx.data = dataTx.data.concat((owner.address).substring(2));
                await expect(trustedForwarder.sendTransaction(dataTx)).to.be.revertedWith("DeniedForTrustedForwarder");

            });
            
        });
        
        for (const trustedForwardMode of [false,true]) {
            context(`via ${trustedForwardMode ? 'trusted forwarder' : 'user'} call`, () => {
                
                beforeEach("deploying", async() => {
                   
                    if (trustedForwardMode) {
                        await CommunityCoin.connect(owner).setTrustedForwarder(trustedForwarder.address);
                    }
                });

                
                it("should stake liquidity", async() => {
                    let allLiquidityAmount = await pairInstance.balanceOf(liquidityHolder.address);
                    let halfLiquidityAmount = BigNumber.from(allLiquidityAmount).div(TWO);
                    await pairInstance.connect(liquidityHolder).transfer(alice.address, halfLiquidityAmount);
                    await pairInstance.connect(alice).approve(communityStakingPool.address, halfLiquidityAmount);
                    let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);

                    if (trustedForwardMode) {
                        const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['stakeLiquidity(uint256)'](halfLiquidityAmount);
                        dataTx.data = dataTx.data.concat((alice.address).substring(2));
                        await trustedForwarder.sendTransaction(dataTx);
                    } else {
                        await communityStakingPool.connect(alice)['stakeLiquidity(uint256)'](halfLiquidityAmount);
                    }
                    let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                    expect(lptokens).not.to.be.eq(lptokensBefore);

                });

                it("should sellAndStakeLiquidity", async () => {
                    let uniswapV2PairInstance = await ethers.getContractAt("IUniswapV2PairMock",await communityStakingPool.uniswapV2Pair());
                    await erc20TradedToken.mint(bob.address, ONE_ETH.mul(TEN));
                    await erc20TradedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));
                    let reservesBefore = await uniswapV2PairInstance.getReserves();
                    
                    if (trustedForwardMode) {
                        const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['sellAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                        dataTx.data = dataTx.data.concat((bob.address).substring(2));
                        await trustedForwarder.sendTransaction(dataTx);
                    } else {
                        await communityStakingPool.connect(bob)['sellAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                    }
                    let shares = await CommunityCoin.balanceOf(bob.address);
                    let reservesAfter = await uniswapV2PairInstance.getReserves();

                    let token0 = await uniswapV2PairInstance.token0();
                    if (erc20TradedToken.address == token0) {
                        expect(reservesAfter[0]).to.be.gt(reservesBefore[0]);
                        expect(reservesAfter[1]).to.be.eq(reservesBefore[1]);
                    } else {
                        expect(reservesAfter[0]).to.be.eq(reservesBefore[0]);
                        expect(reservesAfter[1]).to.be.gt(reservesBefore[1]);
                    }
                    
                    expect(shares).not.to.be.eq(ZERO);
                }); 

                it("should sellAndStakeLiquidity(beneficiary)", async () => {
                    let uniswapV2PairInstance = await ethers.getContractAt("IUniswapV2PairMock",await communityStakingPool.uniswapV2Pair());
                    await erc20TradedToken.mint(bob.address, ONE_ETH.mul(TEN));
                    await erc20TradedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));
                    let reservesBefore = await uniswapV2PairInstance.getReserves();
                    
                    if (trustedForwardMode) {
                        const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['sellAndStakeLiquidity(uint256,address)'](ONE_ETH.mul(ONE), frank.address);
                        dataTx.data = dataTx.data.concat((bob.address).substring(2));
                        await trustedForwarder.sendTransaction(dataTx);
                    } else {
                        await communityStakingPool.connect(bob)['sellAndStakeLiquidity(uint256,address)'](ONE_ETH.mul(ONE), frank.address);
                    }
                    let sharesBob = await CommunityCoin.balanceOf(bob.address);
                    let sharesFrank = await CommunityCoin.balanceOf(frank.address);
                    let reservesAfter = await uniswapV2PairInstance.getReserves();

                    let token0 = await uniswapV2PairInstance.token0();
                    if (erc20TradedToken.address == token0) {
                        expect(reservesAfter[0]).to.be.gt(reservesBefore[0]);
                        expect(reservesAfter[1]).to.be.eq(reservesBefore[1]);
                    } else {
                        expect(reservesAfter[0]).to.be.eq(reservesBefore[0]);
                        expect(reservesAfter[1]).to.be.gt(reservesBefore[1]);
                    }
                    
                    expect(sharesBob).to.be.eq(ZERO);
                    expect(sharesFrank).not.to.be.eq(ZERO);
                }); 


                it("should addAndStakeLiquidity", async () => {
                    let uniswapV2PairInstance = await ethers.getContractAt("IUniswapV2PairMock",await communityStakingPool.uniswapV2Pair());
                    await erc20TradedToken.mint(bob.address, ONE_ETH.mul(TEN));
                    await erc20TradedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));
                    await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(TEN));
                    await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(TEN));

                    let reservesBefore = await uniswapV2PairInstance.getReserves();
                    
                    if (trustedForwardMode) {
                        const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['addAndStakeLiquidity(uint256,uint256)'](ONE_ETH.mul(ONE), ONE_ETH.mul(ONE));
                        dataTx.data = dataTx.data.concat((bob.address).substring(2));
                        await trustedForwarder.sendTransaction(dataTx);
                    } else {
                        await expect( communityStakingPool.connect(bob).addAndStakeLiquidity(ZERO, ONE_ETH.mul(ONE)) ).to.be.revertedWith("AMOUNT_EMPTY");
                        await expect( communityStakingPool.connect(bob).addAndStakeLiquidity(ONE_ETH.mul(ONE),ZERO) ).to.be.revertedWith("AMOUNT_EMPTY");
                        await communityStakingPool.connect(bob).addAndStakeLiquidity(ONE_ETH.mul(ONE), ONE_ETH.mul(TEN));
                    }
                    
                    let shares = await CommunityCoin.balanceOf(bob.address);
                    let reservesAfter = await uniswapV2PairInstance.getReserves();
            
                    expect(reservesAfter[0]).to.be.gt(reservesBefore[0]);
                    expect(reservesAfter[1]).to.be.gt(reservesBefore[1]);
                    
                    
                    expect(shares).not.to.be.eq(ZERO);

                }); 

                // describe("through erc20ReservedToken", function () {
                // });
                
                describe("through erc20ReservedToken", function () {
                    if (!trustedForwardMode) {
                        it("beneficiary test", async () => {
                        
                            await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                            await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));

                            let walletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                            let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);
                            
                            await communityStakingPool.connect(bob)['buyAndStakeLiquidity(uint256,address)'](ONE_ETH.mul(ONE), charlie.address);

                            let walletTokens = await CommunityCoin.balanceOf(charlie.address);
                            let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                            // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                            expect(BigNumber.from(lptokens)).not.to.be.eq(ZERO);
                            expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;

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

                    //     //await communityStakingPool.connect(alice)['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                    //     // trick with set up msgsender for TrustedForwarder calls
                    //     const lqBuyTx = await communityStakingPool.connect(alice).populateTransaction['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                    //     lqBuyTx.data = lqBuyTx.data.concat((bob.address).substring(2));
                    //     await alice.sendTransaction(lqBuyTx);
                    //     //-----

                    //     let walletTokens = await CommunityCoin.balanceOf(bob.address);
                    //     let lptokens = await pairInstance.balanceOf(communityStakingPool.address);

                    //     // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                    //     expect(BigNumber.from(lptokens)).not.to.be.eq(ZERO);
                    //     expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;

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
                                const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await trustedForwarder.sendTransaction(dataTx);
                            } else {
                                await communityStakingPool.connect(bob)['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                            }

                            stakingBalanceToken1After = await erc20ReservedToken.balanceOf(communityStakingPool.address);
                            stakingBalanceToken2After = await erc20TradedToken.balanceOf(communityStakingPool.address);
                        });

                        it("buyAddLiquidityAndStake", async () => {
                    
                            let walletTokens = await CommunityCoin.balanceOf(bob.address);
                            let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                            // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                            expect(BigNumber.from(lptokens)).not.to.be.eq(ZERO);
                            expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;

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
                                await expect(trustedForwarder.sendTransaction(dataTx)).to.be.revertedWith(`StakeNotUnlockedYet("${bob.address}", ${walletTokens}, 0)`);
                            } else {
                                await expect(CommunityCoin.connect(bob).unstake(walletTokens)).to.be.revertedWith(`StakeNotUnlockedYet("${bob.address}", ${walletTokens}, 0)`);
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
                            
                            let revertMsg = `MissingRole("${bob.address}", ${REDEEM_ROLE})`;
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
                                const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
                                dataTx.data = dataTx.data.concat((bob.address).substring(2));
                                await trustedForwarder.sendTransaction(dataTx);
                            } else {
                                await communityStakingPool.connect(bob)['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
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
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyAndStakeLiquidity(address,uint256)'](erc20.address, ONE_ETH.mul(ONE));
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyAndStakeLiquidity(address,uint256)'](erc20.address, ONE_ETH.mul(ONE));
                        }
                    
                        let walletTokens = await CommunityCoin.balanceOf(bob.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake

                        expect(lptokens).not.to.be.eq(ZERO);
                        expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;
                    
                    });    

                    it("buyAddLiquidityAndStake (beneficiary)", async () => {
                
                        let walletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                        let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);

                        // now addinig liquidity through paying token will be successful
                        if (trustedForwardMode) {
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyAndStakeLiquidity(address,uint256,address)'](erc20.address, ONE_ETH.mul(ONE), charlie.address);
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyAndStakeLiquidity(address,uint256,address)'](erc20.address, ONE_ETH.mul(ONE), charlie.address);
                        }
                    
                        let walletTokens = await CommunityCoin.balanceOf(charlie.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                            
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake

                        expect(lptokens).not.to.be.eq(ZERO);
                        expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;

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
                        
                        await communityStakingPool.connect(bob)['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
                        if (trustedForwardMode) {
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyAndStakeLiquidity()']({value: ONE_ETH.mul(ONE) });
                        }
    
                        let walletTokens = await CommunityCoin.balanceOf(bob.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                        
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                        expect(lptokens).not.to.be.eq(ZERO);

                        //expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);
                        // float number
                        expect(
                            lptokens.mul(numerator).div(denominator).div(10).mul(10)
                        ).to.be.eq(
                            walletTokens.div(10).mul(10)
                        );
                        
                    });    

                    it("buyAddLiquidityAndStake (beneficiary)", async () => {
                        let walletTokensBefore = await CommunityCoin.balanceOf(charlie.address);
                        let lptokensBefore = await pairInstance.balanceOf(communityStakingPool.address);

                        if (trustedForwardMode) {
                            const dataTx = await communityStakingPool.connect(trustedForwarder).populateTransaction['buyAndStakeLiquidity(address)'](charlie.address, {value: ONE_ETH.mul(ONE) });
                            dataTx.data = dataTx.data.concat((bob.address).substring(2));
                            await trustedForwarder.sendTransaction(dataTx);
                        } else {
                            await communityStakingPool.connect(bob)['buyAndStakeLiquidity(address)'](charlie.address, {value: ONE_ETH.mul(ONE) });
                        }

                        
                        let walletTokens = await CommunityCoin.balanceOf(charlie.address);
                        let lptokens = await pairInstance.balanceOf(communityStakingPool.address);
                        
                        // custom situation when  uniswapLP tokens equal sharesLP tokens.  can be happens in the first stake
                        expect(lptokens).not.to.be.eq(ZERO);
                        expect(lptokens.mul(numerator).div(denominator)).to.be.eq(walletTokens);;
                        
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
                instanceManagementInstance = await ethers.getContractAt("CommunityStakingPoolFactory",instanceManagementAddr);
                
            });
            it("should return instance info", async () => {
                
                let data = await instanceManagementInstance.connect(bob).getInstanceInfo(erc20ReservedToken.address, erc20TradedToken.address, lockupIntervalCount);
                
                expect(data.reserveToken).to.be.eq(erc20ReservedToken.address);
                expect(data.tradedToken).to.be.eq(erc20TradedToken.address);
                expect(data.duration).to.be.eq(lockupIntervalCount);
                
            }); 
            
            it("should return all instances info", async () => {
                
                let data = await instanceManagementInstance.connect(bob).getInstancesInfo();
                
                expect(data[0].reserveToken).to.be.eq(erc20ReservedToken.address);
                expect(data[0].tradedToken).to.be.eq(erc20TradedToken.address);
                expect(data[0].duration).to.be.eq(lockupIntervalCount);
                expect(data[0].bonusTokenFraction).to.be.eq(NO_BONUS_FRACTIONS);
                
            }); 
            
            it("should return correct instance length", async () => {
                let data = await instanceManagementInstance.connect(bob).instancesCount();
                expect(data).to.be.eq(ONE);
            }); 

            it("should return correct instance by index", async () => {
                let instance = await instanceManagementInstance.connect(bob).instancesByIndex(0);
                expect(instance).to.be.eq(communityStakingPool.address);
            }); 
        }); 

        describe("unstake/redeem/redeem-and-remove-liquidity tests", function () {
            var shares;
            beforeEach("before each callback", async() => {
                
                await erc20ReservedToken.mint(bob.address, ONE_ETH.mul(ONE));
                await erc20ReservedToken.connect(bob).approve(communityStakingPool.address, ONE_ETH.mul(ONE));
                await communityStakingPool.connect(bob)['buyAndStakeLiquidity(uint256)'](ONE_ETH.mul(ONE));
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

            it("shouldn't accept unknown tokens if send directly", async () => {
                let anotherToken = await ERC777Factory.deploy("Another ERC777 Token", "A-ERC777");
                await anotherToken.mint(bob.address, ONE_ETH);
                await expect(anotherToken.connect(bob).transfer(CommunityCoin.address, ONE_ETH)).to.be.revertedWith(
                    `OwnTokensPermittedOnly()`
                );
            });

            describe("unstake tests", function () {
                describe("shouldnt unstake", function () {
                    it("if not unlocked yet", async () => {
                        await expect(CommunityCoin.connect(bob)["unstake(uint256)"](shares)).to.be.revertedWith(`StakeNotUnlockedYet("${bob.address}", ${shares}, 0)`);
                    });
                    it("if amount more than balance", async () => {
                        // pass some mtime
                        await time.increase(lockupIntervalCount*dayInSeconds+9);    

                        await expect(CommunityCoin.connect(bob)["unstake(uint256)"](shares.add(ONE_ETH))).to.be.revertedWith(`InsufficientBalance("${bob.address}", ${shares.add(ONE_ETH)})`);
                    });
                    
                    it("if happens smth unexpected with pool", async () => {

                        await time.increase(lockupIntervalCount*dayInSeconds+9);    
                        
                        let bobReservedTokenBefore = await erc20ReservedToken.balanceOf(bob.address);
                        let bobTradedTokenBefore = await erc20TradedToken.balanceOf(bob.address);

                        await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);

                        // broke contract and emulate 'Error when unstake' response
                        await communityStakingPool.setUniswapPair(ZERO_ADDRESS);

                        await expect(CommunityCoin.connect(bob)["unstake(uint256)"](shares)).to.be.revertedWith("UNSTAKE_ERROR()");
        
                    }); 
                });
                describe("should unstake", function () {
                        var uniswapV2PairInstance;
                    beforeEach("before each callback", async() => {
                        let uniswapV2PairAddress = await communityStakingPool.uniswapV2Pair();
                        uniswapV2PairInstance = await ethers.getContractAt("ERC20Mintable",uniswapV2PairAddress);
                    });
                    it("successfull ", async () => {
                        // pass some mtime
                        await time.increase(lockupIntervalCount*dayInSeconds+9);    

                        let bobLPTokenBefore = await uniswapV2PairInstance.balanceOf(bob.address);
                        let bobReservedTokenBefore = await erc20ReservedToken.balanceOf(bob.address);
                        let bobTradedTokenBefore = await erc20TradedToken.balanceOf(bob.address);

                        await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);
                        await CommunityCoin.connect(bob)["unstake(uint256)"](shares);

                        let bobLPTokenAfter = await uniswapV2PairInstance.balanceOf(bob.address);
                        let bobReservedTokenAfter = await erc20ReservedToken.balanceOf(bob.address);
                        let bobTradedTokenAfter = await erc20TradedToken.balanceOf(bob.address);
                        
                        expect(bobLPTokenAfter).gt(bobLPTokenBefore);
                        expect(bobReservedTokenAfter).eq(bobReservedTokenBefore);
                        expect(bobTradedTokenAfter).eq(bobTradedTokenBefore);

                    });
                    it("successfull RRL", async () => {
                        // pass some mtime
                        await time.increase(lockupIntervalCount*dayInSeconds+9);    
                        
                        let bobLPTokenBefore = await uniswapV2PairInstance.balanceOf(bob.address);
                        let bobReservedTokenBefore = await erc20ReservedToken.balanceOf(bob.address);
                        let bobTradedTokenBefore = await erc20TradedToken.balanceOf(bob.address);

                        await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);
                        await CommunityCoin.connect(bob)["unstakeAndRemoveLiquidity(uint256)"](shares);

                        let bobLPTokenAfter = await uniswapV2PairInstance.balanceOf(bob.address);
                        let bobReservedTokenAfter = await erc20ReservedToken.balanceOf(bob.address);
                        let bobTradedTokenAfter = await erc20TradedToken.balanceOf(bob.address);

                        expect(bobLPTokenAfter).eq(bobLPTokenBefore);
                        expect(bobReservedTokenAfter).gt(bobReservedTokenBefore);
                        expect(bobTradedTokenAfter).gt(bobTradedTokenBefore);
                    });
                });
            });

            //                      redeem , redeemAndRemoveLiquidity                                    
            for (const forkAction of [true, false]) {

                context(`${forkAction ? 'redeem' : 'redeem and remove liquidity(RRL)'} reserve token`, () => {
                    describe(`shouldnt ${forkAction ? 'redeem' : 'RRL' }`, function () {

                        it("if happens smth unexpected with pool", async () => {

                            // pass some mtime
                            await time.increase(lockupIntervalCount*dayInSeconds+9);   
                            
                            // imitate exists role
                            await mockCommunity.connect(owner).setRoles(alice.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);
                            
                            // transfer from bob to alice
                            await CommunityCoin.connect(bob).transfer(alice.address, shares);
                            
                            await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);

                            // broke contract and emulate 'Error when redeem in an instance' response
                            await communityStakingPool.setUniswapPair(ZERO_ADDRESS);

                            await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith("REDEEM_ERROR()");


                        }); 

                        describe("without redeem role", function () {
                            it("if send directly", async() => {
                                await expect(CommunityCoin.connect(bob).transfer(CommunityCoin.address, shares)).to.be.revertedWith(
                                    `MissingRole("${bob.address}", ${REDEEM_ROLE})`
                                );
                            });

                            it("if anyone didn't transfer tokens to you before", async () => {
                                await expect(CommunityCoin.connect(bob)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                    `MissingRole("${bob.address}", ${REDEEM_ROLE})`
                                );
                            });
                            describe("after someone transfer", function () {  
                                beforeEach("before each callback", async() => {
                                    await CommunityCoin.connect(bob).transfer(alice.address, shares);
                                });  
                                
                                it("without approve before", async () => {
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        `MissingRole("${alice.address}", ${REDEEM_ROLE})`
                                    );
                                });
                                it("without approve before even if passed time", async () => {
                                    // pass some mtime
                                    await time.increase(lockupIntervalCount*dayInSeconds+9);    
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        `MissingRole("${alice.address}", ${REDEEM_ROLE})`
                                    );
                                });
                                
                                it("with approve before", async () => {
                                    await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        `MissingRole("${alice.address}", ${REDEEM_ROLE})`
                                    );
                                });
                                it("with approve before even if passed time", async () => {
                                    await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);
                                    // pass some mtime
                                    await time.increase(lockupIntervalCount*dayInSeconds+9);    

                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                        `MissingRole("${alice.address}", ${REDEEM_ROLE})`
                                    );

                                });
                            
                            });     
                        
                        });

                        describe("with redeem role", function () {
                            beforeEach("before each callback", async() => {
                                
                                // imitate exists role
                                await mockCommunity.connect(owner).setRoles(bob.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);
                                
                            });

                            it("if anyone didn't transfer tokens to you before", async () => {
                                await expect(CommunityCoin.connect(bob)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(`AmountExceedsAllowance("${bob.address}", ${shares})`);
                            });
        
                            it("but without transfer to some one", async () => {
                                // means that bob have tokens(after stake), he have redeem role, but totalRedeemable are zero
                                // here it raise a erc777 
                                
                                //!!await CommunityCoin.connect(owner).grantRole(ethers.utils.formatBytes32String(REDEEM_ROLE), bob.address);
                                await CommunityCoin.connect(bob).approve(CommunityCoin.address, shares);

                                await expect(CommunityCoin.connect(bob)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(
                                    `InsufficientBalance("${bob.address}", ${shares})`
                                );
                            });
                            
                            describe("after someone transfer", function () {  
                                beforeEach("before each callback", async() => {
                                    await CommunityCoin.connect(bob).transfer(alice.address, shares);
                                    
                                    // imitate exists role
                                    await mockCommunity.connect(owner).setRoles(alice.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);
                                    
                                });  
                                
                                it("without approve before", async () => {
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(`AmountExceedsAllowance("${alice.address}", ${shares})`);
                                });
                                it("without approve before even if passed time", async () => {
                                    // pass some mtime
                                    await time.increase(lockupIntervalCount*dayInSeconds+9);    
                                    await expect(CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares)).to.be.revertedWith(`AmountExceedsAllowance("${alice.address}", ${shares})`);
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
                            
                            // imitate exists role
                            await mockCommunity.connect(owner).setRoles(alice.address, [0x99,0x98,0x97,0x96,REDEEM_ROLE]);
                            
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

                        it("should redeem directly", async() => {
                            aliceLPTokenBefore = await uniswapV2PairInstance.balanceOf(alice.address);
                            await CommunityCoin.connect(alice).transfer(CommunityCoin.address, shares);
                            aliceLPTokenAfter = await uniswapV2PairInstance.balanceOf(alice.address);
                            expect(aliceLPTokenAfter).gt(aliceLPTokenBefore);
                        });

                        for (const preferredInstance of [false, true]) {
                        for (const swapThroughMiddle of [false, true]) {

                            it(""+`via ${forkAction ? 'redeem' : 'redeemAndRemoveLiquidity'} method`+` ${preferredInstance ? 'with preferred instances' : ''}` + ` ${swapThroughMiddle ? 'and swap through middle token' : ''}`, async () => {
                                var amountAfterSwapLP, tokenAfterSwap, aliceFakeUSDTToken;
                                await CommunityCoin.connect(alice).approve(CommunityCoin.address, shares);
                                if (preferredInstance) {
                                    let instanceManagementAddr = await CommunityCoin.connect(bob).instanceManagment();
                                    instanceManagementInstance = await ethers.getContractAt("CommunityStakingPoolFactory",instanceManagementAddr);
                                    let pList = await instanceManagementInstance.instances();

                                    if (!forkAction && preferredInstance) {

                                        if (swapThroughMiddle) {

                                            //Gettting how much tokens USDT user will obtain if swap all lp to usdt through middle token
                                            tmp = await CommunityCoin.connect(alice).simulateRedeemAndRemoveLiquidity(
                                                alice.address, 
                                                shares, 
                                                pList, 
                                                [
                                                    //[fakeMiddle.address, instanceManagementAddr],
                                                    [fakeMiddle.address, fakeUSDT.address]
                                                    
                                                ]
                                            );
                                        } else {
                                            //Gettting how much tokens USDT user will obtain if swap all lp to usdt
                                             tmp = await CommunityCoin.connect(alice).simulateRedeemAndRemoveLiquidity(
                                                alice.address, 
                                                shares, 
                                                pList, 
                                                [
                                                    [fakeUSDT.address]
                                                ]
                                            );
                                            
                                        }
                                        tokenAfterSwap = tmp[0];
                                        amountAfterSwapLP = tmp[1];
                                        
                                    }

                                    await CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256,address[])' : 'redeemAndRemoveLiquidity(uint256,address[])'}`](shares, pList);

                                } else {

                                    await CommunityCoin.connect(alice)[`${forkAction ? 'redeem(uint256)' : 'redeemAndRemoveLiquidity(uint256)'}`](shares);

                                }
                                aliceLPTokenAfter = await uniswapV2PairInstance.balanceOf(alice.address);
                                aliceReservedTokenAfter = await erc20ReservedToken.balanceOf(alice.address);
                                aliceTradedTokenAfter = await erc20TradedToken.balanceOf(alice.address);

                                if (!forkAction && preferredInstance) {
                                    // now swap reserve and traded tokens to usdt
                                    const ts = await time.latest();
                                    const timeUntil = parseInt(ts)+parseInt(lockupIntervalCount*dayInSeconds);

                                    // erc20TradedToken->erc20ReservedToken
                                    await erc20TradedToken.connect(alice).approve(uniswapRouterInstance.address, aliceTradedTokenAfter.sub(aliceTradedTokenBefore));
                                    tmp2 = await uniswapRouterInstance.connect(alice).swapExactTokensForTokens(
                                        aliceTradedTokenAfter.sub(aliceTradedTokenBefore), 0, [erc20TradedToken.address, erc20ReservedToken.address], alice.address, timeUntil
                                    );

                                    aliceReservedTokenAfter = await erc20ReservedToken.balanceOf(alice.address);

                                    if (swapThroughMiddle) {
                                        
                                        let aliceMiddleTokenBefore = await fakeMiddle.balanceOf(alice.address);

                                        // total erc20ReservedToken->middle->usdt
                                        await erc20ReservedToken.connect(alice).approve(uniswapRouterInstance.address, aliceReservedTokenAfter.sub(aliceReservedTokenBefore));
                                        await uniswapRouterInstance.connect(alice).swapExactTokensForTokens(
                                            aliceReservedTokenAfter.sub(aliceReservedTokenBefore), 0, [erc20ReservedToken.address, fakeMiddle.address], alice.address, timeUntil
                                        );
                                        let aliceMiddleTokenAfter = await fakeMiddle.balanceOf(alice.address);

                                        await fakeMiddle.connect(alice).approve(uniswapRouterInstance.address, aliceMiddleTokenAfter.sub(aliceMiddleTokenBefore));
                                        await uniswapRouterInstance.connect(alice).swapExactTokensForTokens(
                                            aliceMiddleTokenAfter.sub(aliceMiddleTokenBefore), 0, [fakeMiddle.address, fakeUSDT.address], alice.address, timeUntil
                                        );

                                    } else {

                                        await erc20ReservedToken.connect(alice).approve(uniswapRouterInstance.address, aliceReservedTokenAfter.sub(aliceReservedTokenBefore));
                                        await uniswapRouterInstance.connect(alice).swapExactTokensForTokens(
                                            aliceReservedTokenAfter.sub(aliceReservedTokenBefore), 0, [erc20ReservedToken.address, fakeUSDT.address], alice.address, timeUntil
                                        );
                                        
                                    }

                                    aliceFakeUSDTToken = await fakeUSDT.balanceOf(alice.address);

                                    // and compare with amountAfterSwapLP. it should be the same
                                    expect(amountAfterSwapLP).to.be.eq(aliceFakeUSDTToken);
                                    expect(amountAfterSwapLP).not.to.be.eq(ZERO);
                                    expect(aliceFakeUSDTToken).not.to.be.eq(ZERO);
                                    
                                }

                                if (forkAction) {
                                    expect(aliceLPTokenAfter).gt(aliceLPTokenBefore);
                                } else {
                                    
                                    expect(aliceReservedTokenAfter).gt(aliceReservedTokenBefore);
                                    expect(aliceTradedTokenAfter).gt(aliceTradedTokenBefore);
                                }
  
                            });
                        }
                        }

                        if (forkAction) {
                            it("via directly send to contract", async () => {
                                await CommunityCoin.connect(alice).transfer(CommunityCoin.address, shares);
                                aliceLPTokenAfter = await uniswapV2PairInstance.balanceOf(alice.address);
                                expect(aliceLPTokenAfter).gt(aliceLPTokenBefore);
                            });

                            describe("discountSensivityTests", function () {
                                var amountWithout, amountWith;
                                it("calculate amount obtain without circulation", async () => {
                                    await CommunityCoin.connect(alice).transfer(CommunityCoin.address, shares);
                                    amountWithout = await uniswapV2PairInstance.balanceOf(alice.address);
                                });

                                it("calculate amount obtain with circulation", async () => {
                                    
                                    // imitate exists role
                                    //await mockCommunity.connect(owner).setRoles([0x99,0x98,0x97,0x96,CIRCULATE_ROLE]);
                                    await mockCommunity.connect(owner).setRoles(charlie.address, [0x99,0x98,0x97,CIRCULATE_ROLE,REDEEM_ROLE]);

                                    await CommunityCoin.connect(charlie).addToCirculation(charlie.address, shares);
                                    await CommunityCoin.connect(alice).transfer(CommunityCoin.address, shares);
                                    amountWith = await uniswapV2PairInstance.balanceOf(alice.address);
                                });

                                it("check correct sensivity discount", async () => {
                                    // if total shares = X and admin will add to circulation on X more
                                    // then the user will obtain in a two times less

                                    //expect(amountWithout.div(amountWith)).to.be.eq(TWO); // it will be if sensitivityDiscount is zero
                                    expect(amountWithout.div(amountWith)).to.be.eq(FOUR);
                                });
                                
                            });
                        }
                        
                    
                    });
                });

            } // end for 
        
        });      
  
    });


});