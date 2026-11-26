import { parseAbi } from 'viem';

export const LIGHTER_DEPOSIT_ABI = parseAbi(['function deposit(address _to, uint16 _assetIndex, uint8 _routeType, uint256 _amount) payable']);
export const DERIVE_ACTION_MANAGER_ABI = parseAbi(['function depositToNewSubaccount(address asset, uint256 amount, uint32 managerId, address owner) returns (uint256 actionId)']);
export const MOCK_MINT_ABI = parseAbi(['function mint(address to, uint256 amount)']);
