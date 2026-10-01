import { Endpoints } from '#common/constants'
import { useFetch } from '#common/helpers'
import { createArtistPayload } from '#modules/artists/helpers'
import { createSongPayload } from '#modules/songs/helpers'
import { createAlbumPayload } from '#modules/albums/helpers'
import { HTTPException } from 'hono/http-exception'
import type { IUseCase } from '#common/types'
import type {
  ArtistAPIResponseModel,
  ArtistSongAPIResponseModel,
  ArtistAlbumAPIResponseModel,
  ArtistModel
} from '#modules/artists/models'
import type { z } from 'zod'

export interface GetArtistByIdArgs {
  artistId: string
  page: number
  songCount: number
  albumCount: number
  sortBy: 'popularity' | 'latest' | 'alphabetical'
  sortOrder: 'asc' | 'desc'
}

export class GetArtistByIdUseCase implements IUseCase<GetArtistByIdArgs, z.infer<typeof ArtistModel>> {
  constructor() {}

  async execute({ artistId, page, songCount, albumCount, sortBy, sortOrder }: GetArtistByIdArgs) {
    const { data } = await useFetch<z.infer<typeof ArtistAPIResponseModel>>({
      endpoint: Endpoints.artists.id,
      params: {
        artistId,
        n_song: songCount,
        n_album: albumCount,
        page,
        sort_order: sortOrder,
        category: sortBy
      }
    })

    if (!data) throw new HTTPException(404, { message: 'artist not found' })

    const payload = createArtistPayload(data)

    // Fallback: if topSongs/topAlbums are empty (happens on datacenter IPs),
    // fetch them from the dedicated endpoints which bypass the restriction.
    const needsSongsFallback = !payload.topSongs || payload.topSongs.length === 0
    const needsAlbumsFallback = !payload.topAlbums || payload.topAlbums.length === 0

    if (needsSongsFallback || needsAlbumsFallback) {
      const fallbacks = await Promise.allSettled([
        needsSongsFallback
          ? useFetch<z.infer<typeof ArtistSongAPIResponseModel>>({
              endpoint: Endpoints.artists.songs,
              params: { artistId, page: 0, sort_order: sortOrder, category: sortBy }
            })
          : Promise.resolve(null),
        needsAlbumsFallback
          ? useFetch<z.infer<typeof ArtistAlbumAPIResponseModel>>({
              endpoint: Endpoints.artists.albums,
              params: { artistId, page: 0, sort_order: sortOrder, category: sortBy }
            })
          : Promise.resolve(null),
      ])

      const [songsResult, albumsResult] = fallbacks

      if (needsSongsFallback && songsResult.status === 'fulfilled' && songsResult.value) {
        const songsData = songsResult.value.data
        if (songsData?.topSongs?.songs?.length) {
          payload.topSongs = songsData.topSongs.songs.map(createSongPayload)
        }
      }

      if (needsAlbumsFallback && albumsResult.status === 'fulfilled' && albumsResult.value) {
        const albumsData = albumsResult.value.data
        if (albumsData?.topAlbums?.albums?.length) {
          payload.topAlbums = albumsData.topAlbums.albums.map(createAlbumPayload)
        }
      }
    }

    return payload
  }
}
