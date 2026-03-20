import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(secretKey: string): Stripe {
	if (!_stripe) {
		_stripe = new Stripe(secretKey, { apiVersion: '2024-12-18.acacia' });
	}
	return _stripe;
}
