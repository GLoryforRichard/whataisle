/** Pure validation shared by runtime tests. Persisted shelf IDs never follow label edits. */
export function validateFloorMap(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    !Number.isInteger(input.revision) ||
    input.revision < 0
  )
    throw new Error('Invalid map revision');
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width < 200 ||
    input.width > 5000 ||
    input.height < 200 ||
    input.height > 5000
  )
    throw new Error('Map dimensions must be between 200 and 5000');
  if (!Array.isArray(input.shelves) || input.shelves.length < 1 || input.shelves.length > 250)
    throw new Error('Add between 1 and 250 shelves');
  const ids = new Set();
  const codes = new Set();
  const shelves = input.shelves.map((s) => {
    if (!s || typeof s.id !== 'string' || !/^s_[a-f0-9]{16}$/.test(s.id) || ids.has(s.id))
      throw new Error('Invalid or duplicate shelf ID');
    if (typeof s.code !== 'string' || !/^[\p{L}\p{N} _-]{1,20}$/u.test(s.code.trim()))
      throw new Error('Shelf labels must use letters or numbers (20 characters maximum)');
    const code = s.code.trim();
    if (codes.has(code.toLocaleLowerCase())) throw new Error('Each shelf needs a different label');
    if (typeof s.description !== 'string' || s.description.length > 120)
      throw new Error('Shelf description is too long');
    if (
      ![s.x, s.y, s.w, s.h].every(Number.isFinite) ||
      s.x < 0 ||
      s.y < 0 ||
      s.w < 12 ||
      s.h < 12 ||
      s.x + s.w > input.width ||
      s.y + s.h > input.height
    )
      throw new Error('A shelf is outside the map');
    ids.add(s.id);
    codes.add(code.toLocaleLowerCase());
    return { id: s.id, code, description: s.description.trim(), x: s.x, y: s.y, w: s.w, h: s.h };
  });
  return { revision: input.revision, width: input.width, height: input.height, shelves };
}
export function assertShelfContinuity(previous, next) {
  const ids = new Set(next.shelves.map((s) => s.id));
  if (previous?.shelves.some((s) => !ids.has(s.id)))
    throw new Error(
      'Existing shelves must be kept so product locations remain attached. Move or rename them instead.'
    );
}
