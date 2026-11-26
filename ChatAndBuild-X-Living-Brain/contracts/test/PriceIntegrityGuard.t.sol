// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PriceIntegrityGuard, IAggregatorV3} from "../src/PriceIntegrityGuard.sol";

contract MockFeed is IAggregatorV3 {
    uint8 public override decimals;
    int256 public answer;
    uint256 public updatedAt;
    bool public broken;

    constructor(uint8 d, int256 a, uint256 at) { decimals = d; answer = a; updatedAt = at; }
    function set(int256 a, uint256 at) external { answer = a; updatedAt = at; }
    function setBroken(bool b) external { broken = b; }
    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        require(!broken, "feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract PriceIntegrityGuardTest is Test {
    PriceIntegrityGuard g;
    MockFeed atlas;
    MockFeed anchor;
    address owner = address(0xA11CE);
    address token = address(0xB570C4);

    function setUp() public {
        vm.warp(1_800_000_000);
        g = new PriceIntegrityGuard(owner);
        atlas = new MockFeed(8, 150_40000000, block.timestamp);   // 150.40 with 8 decimals
        anchor = new MockFeed(18, 150.23e18, block.timestamp);    // 150.23 with 18 decimals
        vm.prank(owner);
        g.setFeed(token, address(atlas), address(anchor), 180, 200); // 180 s, 2%
    }

    function test_ok_and_price_is_scaled_to_18_decimals() public view {
        (PriceIntegrityGuard.Status s, uint256 p, uint256 age) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.OK));
        assertEq(p, 150.4e18);
        assertEq(age, 0);
        assertTrue(g.isTrusted(token));
        assertEq(g.requireTrusted(token), 150.4e18);
    }

    function test_unconfigured_token_is_not_trusted() public view {
        (PriceIntegrityGuard.Status s,,) = g.check(address(0x1234));
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.NOT_CONFIGURED));
        assertFalse(g.isTrusted(address(0x1234)));
    }

    function test_stale_feed() public {
        vm.warp(block.timestamp + 181);
        anchor.set(150.23e18, block.timestamp);
        (PriceIntegrityGuard.Status s,, uint256 age) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.STALE));
        assertEq(age, 181);
        vm.expectRevert(abi.encodeWithSelector(PriceIntegrityGuard.NotTrusted.selector, token, PriceIntegrityGuard.Status.STALE));
        g.requireTrusted(token);
    }

    function test_age_exactly_at_the_limit_is_still_fresh() public {
        vm.warp(block.timestamp + 180);
        anchor.set(150.23e18, block.timestamp);
        (PriceIntegrityGuard.Status s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.OK));
    }

    function test_stale_anchor_is_not_trusted() public {
        vm.warp(block.timestamp + 100);
        atlas.set(150_40000000, block.timestamp);          // feed fresh, anchor 100 s old: fine
        assertTrue(g.isTrusted(token));
        vm.warp(block.timestamp + 100);
        atlas.set(150_40000000, block.timestamp);          // anchor now 200 s old
        assertFalse(g.isTrusted(token));
    }

    function test_diverged_from_anchor() public {
        atlas.set(155_00000000, block.timestamp);           // +3.2% vs 150.23
        (PriceIntegrityGuard.Status s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.DIVERGED));
        atlas.set(152_00000000, block.timestamp);           // +1.2%: inside 2%
        assertTrue(g.isTrusted(token));
    }

    function test_bad_prices_never_revert_check() public {
        atlas.set(0, block.timestamp);
        (PriceIntegrityGuard.Status s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.BAD_PRICE));
        atlas.set(-5, block.timestamp);
        (s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.BAD_PRICE));
        atlas.set(150_40000000, block.timestamp + 1 days);  // timestamp in the future
        (s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.BAD_PRICE));
        atlas.set(150_40000000, block.timestamp);
        atlas.setBroken(true);                              // feed reverts
        (s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.BAD_PRICE));
        anchor.setBroken(true);
        atlas.setBroken(false);                             // anchor reverts
        (s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.BAD_PRICE));
    }

    function test_works_without_an_anchor() public {
        vm.prank(owner);
        g.setFeed(token, address(atlas), address(0), 180, 200);
        atlas.set(999_00000000, block.timestamp);            // nothing to compare with: only freshness is checked
        assertTrue(g.isTrusted(token));
    }

    function test_more_than_18_decimals_scale_down() public {
        MockFeed f = new MockFeed(20, 150_40000000000000000000, block.timestamp);
        vm.prank(owner);
        g.setFeed(token, address(f), address(0), 180, 200);
        (, uint256 p,) = g.check(token);
        assertEq(p, 150.4e18);
    }

    function test_only_owner_can_configure() public {
        vm.expectRevert(PriceIntegrityGuard.NotOwner.selector);
        g.setFeed(token, address(atlas), address(0), 180, 200);
        vm.expectRevert(PriceIntegrityGuard.NotOwner.selector);
        g.removeFeed(token);
    }

    function test_limits_are_enforced() public {
        vm.startPrank(owner);
        vm.expectRevert(PriceIntegrityGuard.BadLimits.selector);
        g.setFeed(token, address(atlas), address(0), 0, 200);
        vm.expectRevert(PriceIntegrityGuard.BadLimits.selector);
        g.setFeed(token, address(atlas), address(0), 1 days + 1, 200);
        vm.expectRevert(PriceIntegrityGuard.BadLimits.selector);
        g.setFeed(token, address(atlas), address(0), 180, 0);
        vm.expectRevert(PriceIntegrityGuard.BadLimits.selector);
        g.setFeed(token, address(atlas), address(0), 180, 5_001);
        vm.expectRevert(PriceIntegrityGuard.ZeroAddress.selector);
        g.setFeed(token, address(0), address(0), 180, 200);
        vm.stopPrank();
    }

    function test_remove_feed() public {
        vm.prank(owner);
        g.removeFeed(token);
        (PriceIntegrityGuard.Status s,,) = g.check(token);
        assertEq(uint8(s), uint8(PriceIntegrityGuard.Status.NOT_CONFIGURED));
    }

    function test_two_step_ownership() public {
        address next = address(0xBEEF);
        vm.prank(owner);
        g.transferOwnership(next);
        assertEq(g.owner(), owner);                          // not yet
        vm.expectRevert(PriceIntegrityGuard.NotPending.selector);
        g.acceptOwnership();                                 // a stranger cannot accept
        vm.prank(next);
        g.acceptOwnership();
        assertEq(g.owner(), next);
        assertEq(g.pendingOwner(), address(0));
    }

    function testFuzz_check_never_reverts(int256 a, uint256 at, uint8 d) public {
        MockFeed f = new MockFeed(d, a, at);
        vm.prank(owner);
        g.setFeed(token, address(f), address(0), 180, 200);
        g.check(token);
    }
}
