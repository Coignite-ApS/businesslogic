package service

import "encoding/json"

// ServicePermission defines access for a single service (calc, ai, flow).
// v3 model: nil = allow all (not configured), [] = deny (actively restricted).
type ServicePermission struct {
	Enabled   bool      `json:"enabled"`
	Resources *[]string `json:"resources"` // nil=all, []=none, ["*"]=all, explicit=match
	Actions   *[]string `json:"actions"`   // nil=all, []=none, explicit=match
}

// ResourcePermissions is the v3 permissions format with per-resource grants.
// null=allow (not configured), []=deny (actively restricted).
type ResourcePermissions struct {
	Services map[string]ServicePermission `json:"services"`
}

// HasAccess checks if the key grants access to a specific resource+action.
// v3: nil services map = allow all. Missing service = allow. Disabled = deny.
// nil resources/actions = allow all. [] = deny. ["*"] = allow all. explicit = match.
func (rp *ResourcePermissions) HasAccess(svc, resourceID, action string) bool {
	// nil services map → full access (key not configured yet)
	if rp.Services == nil {
		return true
	}

	sp, ok := rp.Services[svc]
	// missing service → allow (not configured for this service = full access)
	if !ok {
		return true
	}
	// service present but disabled → deny
	if !sp.Enabled {
		return false
	}

	// Check resources
	if sp.Resources == nil {
		// nil = allow all resources
	} else if len(*sp.Resources) == 0 {
		// [] = actively restricted, no resources allowed
		return false
	} else if len(*sp.Resources) == 1 && (*sp.Resources)[0] == "*" {
		// ["*"] = allow all resources
	} else if !contains(*sp.Resources, resourceID) {
		return false
	}

	// Check actions
	if sp.Actions == nil {
		// nil = allow all actions
	} else if len(*sp.Actions) == 0 {
		// [] = actively restricted, no actions allowed
		return false
	} else if len(*sp.Actions) == 1 && (*sp.Actions)[0] == "*" {
		// ["*"] = allow all actions
	} else if !contains(*sp.Actions, action) {
		return false
	}

	return true
}

// HasServiceAccess checks if a service is accessible (for catalog endpoints
// that don't require a specific resource).
// v3: nil services map = allow all. Missing service = allow. Disabled = deny.
func (rp *ResourcePermissions) HasServiceAccess(svc string) bool {
	// nil services map → full access
	if rp.Services == nil {
		return true
	}

	sp, ok := rp.Services[svc]
	// missing service → allow (not configured = full access)
	if !ok {
		return true
	}
	// service must be enabled
	return sp.Enabled
}

// ParsePermissions parses the JSONB permissions column.
// nil/missing data = full access (v3: null = allow).
// Old flat format {"ai": true} → v3 with nil resources/actions (full access).
func ParsePermissions(data []byte) ResourcePermissions {
	// nil or empty bytes = NULL column = full access
	if len(data) == 0 {
		return ResourcePermissions{Services: nil}
	}

	var rp ResourcePermissions
	if err := json.Unmarshal(data, &rp); err == nil && rp.Services != nil {
		return rp
	}

	// Old flat format {"ai": true} or unparseable → treat as full access (nil services)
	// This preserves the old behavior where true meant "enabled" with full access.
	// The migration 004 will convert existing DB rows to explicit v3 format.
	return ResourcePermissions{Services: nil}
}

func strSlicePtr(s []string) *[]string { return &s }

var DefaultPermissions = ResourcePermissions{
	Services: map[string]ServicePermission{
		"calc": {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"execute", "describe"})},
		"kb":   {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"search", "ask"})},
		"flow": {Enabled: true, Resources: strSlicePtr([]string{"*"}), Actions: strSlicePtr([]string{"trigger"})},
	},
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}
