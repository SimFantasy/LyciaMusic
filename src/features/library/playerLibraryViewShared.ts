import type { AlbumCatalogItem, ArtistCatalogItem, Song } from '../../types';

export type ArtistListItem = ArtistCatalogItem;
export type AlbumListItem = AlbumCatalogItem;

export const isDirectParent = (parentPath: string, childPath: string) => {
  if (!parentPath || !childPath) return false;

  const normalizedParent = parentPath.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedChild = childPath.replace(/\\/g, '/');
  const lastSlash = normalizedChild.lastIndexOf('/');

  return lastSlash !== -1 && normalizedChild.substring(0, lastSlash) === normalizedParent;
};

export const getSongArtistNames = (song: Song) => {
  if (Array.isArray(song.effective_artist_names) && song.effective_artist_names.length > 0) {
    return song.effective_artist_names;
  }

  if (Array.isArray(song.artist_names) && song.artist_names.length > 0) {
    return song.artist_names;
  }

  return [song.artist || 'Unknown'];
};

export const songHasArtist = (song: Song, artistName: string) =>
  getSongArtistNames(song).some(name => name === artistName);

export const getSongAlbumKey = (song: Song) =>
  song.album_key || `${song.album || 'Unknown'}::${song.album_artist || song.artist || 'Unknown'}`;

export const matchesAlbumKey = (song: Song, albumKey: string) => getSongAlbumKey(song) === albumKey;

export const getSongArtistSearchText = (song: Song) =>
  [song.artist, song.album_artist, ...getSongArtistNames(song)].join(' ').toLowerCase();

export const getSongTitleLabel = (song: Song) => song.title || song.name;

export const getSongFileNameLabel = (song: Song) => song.name;
