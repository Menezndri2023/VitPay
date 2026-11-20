export { SDK_VERSION, VitPay } from './client';
export type { VitPayOptions } from './client';
export { VitPayConnectionError, VitPayError, VitPaySignatureError } from './errors';
export { constructEvent, DEFAULT_TOLERANCE_SEC, generateTestHeader } from './webhooks';
export type * from './types';

import { VitPay } from './client';
export default VitPay;
