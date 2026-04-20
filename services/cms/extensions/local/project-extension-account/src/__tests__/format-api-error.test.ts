import { describe, it, expect } from 'vitest';
import { formatApiError } from '../utils/format-api-error';

describe('formatApiError', () => {
	it('returns server errors[0].message when present', () => {
		const err = { response: { status: 403, data: { errors: [{ message: 'Forbidden by policy' }] } } };
		expect(formatApiError(err)).toBe('Forbidden by policy');
	});

	it('prefers server message over status mapping', () => {
		const err = { response: { status: 500, data: { errors: [{ message: 'DB connection failed' }] } } };
		expect(formatApiError(err)).toBe('DB connection failed');
	});

	it('maps 401 to session-expired copy', () => {
		const err = { response: { status: 401, data: {} } };
		expect(formatApiError(err)).toBe('Your session expired. Please log in again.');
	});

	it('maps 403 to permission copy', () => {
		const err = { response: { status: 403, data: {} } };
		expect(formatApiError(err)).toBe("You don't have permission to view this. Contact your account admin.");
	});

	it('maps 404 to not-found copy', () => {
		const err = { response: { status: 404, data: {} } };
		expect(formatApiError(err)).toBe('Not found — this page or data may have been removed.');
	});

	it('maps 500 to server-error copy', () => {
		const err = { response: { status: 500, data: {} } };
		expect(formatApiError(err)).toBe('Something broke on our side. The team has been notified.');
	});

	it('maps 502 to unavailable copy', () => {
		const err = { response: { status: 502, data: {} } };
		expect(formatApiError(err)).toBe('Service temporarily unavailable. Try again in a moment.');
	});

	it('maps 503 to unavailable copy', () => {
		const err = { response: { status: 503, data: {} } };
		expect(formatApiError(err)).toBe('Service temporarily unavailable. Try again in a moment.');
	});

	it('maps 504 to unavailable copy', () => {
		const err = { response: { status: 504, data: {} } };
		expect(formatApiError(err)).toBe('Service temporarily unavailable. Try again in a moment.');
	});

	it('falls back to err.message for unknown status', () => {
		const err = { response: { status: 422, data: {} }, message: 'Unprocessable entity' };
		expect(formatApiError(err)).toBe('Unprocessable entity');
	});

	it('returns fallback string when no response and no message', () => {
		expect(formatApiError({})).toBe('An unexpected error occurred.');
	});

	it('handles no-response network errors via err.message', () => {
		const err = { message: 'Network Error' };
		expect(formatApiError(err)).toBe('Network Error');
	});

	it('handles null/undefined gracefully', () => {
		expect(formatApiError(null)).toBe('An unexpected error occurred.');
		expect(formatApiError(undefined)).toBe('An unexpected error occurred.');
	});
});
