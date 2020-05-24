import { EventFlow } from '@schemeless/event-store';
import { ImageAttachmentEntity } from '../Attachment.entity';
import { getImageAttachmentEntityRepository } from '../Attachment.entity.repository';

interface Payload {
  userId: string;
  sharpMetaData?: SharpMetadata;
  metaData?: {
    format: string;
    width: number;
    height: number;
  };
  s3SendData: S3SendData;
  fileSha1: string;
}

export const AttachmentS3ImageUploaded: EventFlow<Payload> = {
  domain: 'attachment',
  type: 's3ImageUploaded',
  description: 'an image was uploaded to s3',

  samplePayload: {
    userId: 'userId',
    sharpMetaData: {
      chromaSubsampling: ''
    },
    s3SendData: {
      Location: '',
      ETag: '',
      Bucket: '',
      Key: ''
    },
    fileSha1: ''
  },

  validator: async event => {
    // todo check userId
  },

  executor: async event => {
    const attachment = new ImageAttachmentEntity();
    const { userId, sharpMetaData, metaData, s3SendData, fileSha1 } = event.payload;
    attachment.id = fileSha1;
    attachment.userId = userId;
    attachment.sha1 = fileSha1;

    if (sharpMetaData) {
      attachment.width = sharpMetaData.width!;
      attachment.height = sharpMetaData.height!;
    }

    if (metaData) {
      attachment.width = metaData.width!;
      attachment.height = metaData.height!;
    }

    attachment.url = s3SendData.Location;
    attachment.etag = s3SendData.ETag;

    attachment.created = event.created;
    attachment.updated = event.created;

    const repo = await getImageAttachmentEntityRepository();
    await repo.save(attachment);
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(
      AttachmentS3ImageUploaded.domain,
      AttachmentS3ImageUploaded.type,
      eventInputArgs
    )
};

interface SharpMetadata {
  /** Name of decoder used to decompress image data e.g. jpeg, png, webp, gif, svg */
  format?: string;
  /** Total size of image in bytes, for Stream and Buffer input only */
  size?: number;
  /** Number of pixels wide (EXIF orientation is not taken into consideration) */
  width?: number;
  /** Number of pixels high (EXIF orientation is not taken into consideration) */
  height?: number;
  /** Name of colour space interpretation e.g. srgb, rgb, cmyk, lab, b-w ... */
  space?: string;
  /** Number of bands e.g. 3 for sRGB, 4 for CMYK */
  channels?: 3 | 4;
  /** Name of pixel depth format e.g. uchar, char, ushort, float ... */
  depth?: string;
  /** Number of pixels per inch (DPI), if present */
  density?: number;
  /** String containing JPEG chroma subsampling, 4:2:0 or 4:4:4 for RGB, 4:2:0:4 or 4:4:4:4 for CMYK */
  chromaSubsampling: string;
  /** Boolean indicating whether the image is interlaced using a progressive scan */
  isProgressive?: boolean;
  /** Number of pages/frames contained within the image, with support for TIFF, HEIF, PDF, animated GIF and animated WebP */
  pages?: number;
  /** Number of pixels high each page in a multi-page image will be. */
  pageHeight?: number;
  /** Number of times to loop an animated image, zero refers to a continuous loop. */
  loop?: number;
  /** Delay in ms between each page in an animated image, provided as an array of integers. */
  delay?: number[];
  /**  Number of the primary page in a HEIF image */
  pagePrimary?: number;
  /** Boolean indicating the presence of an embedded ICC profile */
  hasProfile?: boolean;
  /** Boolean indicating the presence of an alpha transparency channel */
  hasAlpha?: boolean;
  /** Buffer containing raw EXIF data, if present */
  exif?: Buffer;
  /** Buffer containing raw ICC profile data, if present */
  icc?: Buffer;
  /** Buffer containing raw IPTC data, if present */
  iptc?: Buffer;
  /** Buffer containing raw XMP data, if present */
  xmp?: Buffer;
  /** Buffer containing raw TIFFTAG_PHOTOSHOP data, if present */
  tifftagPhotoshop?: Buffer;
}

interface S3SendData {
  /**
   * URL of the uploaded object.
   */
  Location: string;
  /**
   * ETag of the uploaded object.
   */
  ETag: string;
  /**
   * Bucket to which the object was uploaded.
   */
  Bucket: string;
  /**
   * Key to which the object was uploaded.
   */
  Key: string;
}
