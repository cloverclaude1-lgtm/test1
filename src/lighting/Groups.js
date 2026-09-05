// ---------------------------------------------------------------------------
// Fixture groups
//
// Built-in groups (front/back/left/right/center/pars/movingheads/strobes/all)
// are DERIVED from fixture role/type so they stay correct as fixtures are
// added/removed. Custom groups are explicit id lists stored on the project.
// The lighting engine and rule actions only ever address a *group name*
// (brief §14): "Bass -> Backlights", "Beat -> Strobes", "Chorus -> All Lights".
// ---------------------------------------------------------------------------

export const BUILTIN_GROUPS = ['all', 'front', 'back', 'left', 'right', 'center', 'par', 'spotlight', 'movinghead', 'strobe', 'ledstrip'];

/** Resolves a group id/name to the list of fixture ids it currently contains. */
export function resolveGroup(groupName, fixtures, customGroups = []) {
  if (typeof groupName !== 'string' || !groupName) return [];
  const name = groupName.toLowerCase();

  if (name === 'all') return fixtures.map((f) => f.id);
  if (['front', 'back', 'left', 'right', 'center'].includes(name)) {
    return fixtures.filter((f) => f.role === name).map((f) => f.id);
  }
  if (['par', 'spotlight', 'movinghead', 'strobe', 'ledstrip'].includes(name)) {
    return fixtures.filter((f) => f.type === name).map((f) => f.id);
  }
  const custom = customGroups.find((g) => g.id === groupName || g.name.toLowerCase() === name);
  if (custom) return custom.fixtureIds.slice();
  return [];
}

export function listAllGroups(customGroups = []) {
  return [
    ...BUILTIN_GROUPS.map((id) => ({ id, name: prettyGroupName(id), builtin: true })),
    ...customGroups.map((g) => ({ id: g.id, name: g.name, builtin: false })),
  ];
}

function prettyGroupName(id) {
  const map = { par: 'PARs', movinghead: 'Moving Heads', ledstrip: 'LED Strips' };
  return map[id] || id[0].toUpperCase() + id.slice(1);
}

/** True if `fixture` belongs to the named group (role, type, 'all', or a custom group). */
export function fixtureMatchesGroup(fixture, groupName, customGroups = []) {
  if (typeof groupName !== 'string' || !groupName) return false;
  const name = groupName.toLowerCase();
  if (name === 'all') return true;
  if (['front', 'back', 'left', 'right', 'center'].includes(name)) return fixture.role === name;
  if (['par', 'spotlight', 'movinghead', 'strobe', 'ledstrip'].includes(name)) return fixture.type === name;
  const custom = customGroups.find((g) => g.id === groupName || g.name.toLowerCase() === name);
  return custom ? custom.fixtureIds.includes(fixture.id) : false;
}

export function createCustomGroup(name, fixtureIds = []) {
  return { id: `grp_${Date.now().toString(36)}`, name, fixtureIds };
}
