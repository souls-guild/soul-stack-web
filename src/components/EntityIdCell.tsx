import { Link } from 'react-router-dom';
import { entityCaption, showsIdBeside, type CaptionedEntity } from './entityCaption';
import styles from './EntityIdCell.module.css';

// EntityIdCell — the identity cell of a registry list: the caption on top, the
// identifier under it as secondary text. Shared rather than repeated per list so
// that "label first, id second, id alone when the label is empty" has one
// implementation to read and one to change.
//
// `to` links the caption, not the id, because the caption is what the operator
// clicked; the id is there to disambiguate two entities that chose the same
// caption, which is legal — a label is not unique.
export function EntityIdCell({ entity, to }: { entity: CaptionedEntity; to?: string }) {
  const caption = entityCaption(entity);
  return (
    <span className={styles.cell}>
      {to ? <Link to={to}>{caption}</Link> : <span>{caption}</span>}
      {showsIdBeside(entity) ? (
        <span className={styles.secondary}>{entity.id}</span>
      ) : null}
    </span>
  );
}
