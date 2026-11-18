import type { FormatProfileId } from '../index';
import type { FormatProfile } from './elements';
import { FEATURE_PROFILE } from './feature';

/** TV profiles arrive in M7; until then every project formats as a feature. */
export function getProfile(id: FormatProfileId): FormatProfile {
  switch (id) {
    case 'feature':
    case 'tv_single':
    case 'tv_multi':
      return FEATURE_PROFILE;
  }
}
