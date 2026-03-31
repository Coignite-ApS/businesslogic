package service

import "encoding/json"

// ServicePermission defines access for a single service (calc, ai, flow).
type ServicePermission struct {
	Enabled   bool     `json:"enabled"`
	Resources []string `json:"resources"` // Required — empty = NO access
	Actions   []string `json:"actions"`   // Required — empty = NO access
}

// ResourcePermissions is the v2 permissions format with per-resource grants.
// Deny by default: missing service, empty resources, or empty actions = no access.
type ResourcePermissions struct {
	Services map[string]ServicePermission `json:"services"`
}

// HasAccess checks if the key grants access to a specific resource+action.
// Returns false if service disabled, resource not listed, or action not listed.
func (rp *ResourcePermissions) HasAccess(svc, resourceID, action string) bool {
	if rp.Services == nil {
		return false
	}
	sp, ok := rp.Services[svc]
	if !ok || !sp.Enabled {
		return false
	}
	if len(sp.Resources) == 0 {
		return false
	}
	if !contains(sp.Resources, resourceID) {
		return false
	}
	if len(sp.Actions) == 0 {
		return false
	}
	return contains(sp.Actions, action)
}

// HasServiceAccess checks if a service is enabled at all (for catalog endpoints
// that don't require a specific resource).
func (rp *ResourcePermissions) HasServiceAccess(svc string) bool {
	if rp.Services == nil {
		return false
	}
	sp, ok := rp.Services[svc]
	return ok && sp.Enabled
}

// ParsePermissions parses the JSONB permissions column.
// Old flat format {"ai": true} results in NO access (migration required).
func ParsePermissions(data []byte) ResourcePermissions {
	var rp ResourcePermissions
	if err := json.Unmarshal(data, &rp); err == nil && rp.Services != nil {
		return rp
	}

	// Old flat format → return empty (no access)
	return ResourcePermissions{Services: map[string]ServicePermission{}}
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
