export function requireAuth(req: any, res: any, next: any): void {
	if (!req.accountability?.user) {
		res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		return;
	}
	next();
}

export function requireAdmin(req: any, res: any, next: any): void {
	if (!req.accountability?.admin) {
		res.status(403).json({ errors: [{ message: 'Admin access required' }] });
		return;
	}
	next();
}
