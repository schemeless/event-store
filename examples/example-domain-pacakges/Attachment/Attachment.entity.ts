import { Column, Entity, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';

@Entity()
export class ImageAttachmentEntity {
  @PrimaryColumn({ nullable: false })
  id: string;

  @Column({ nullable: false })
  userId: string;

  @Column()
  sha1: string;

  @Column()
  width: number;

  @Column()
  height: number;

  @Column()
  url: string;

  @Column()
  etag: string;

  @Column()
  updated: Date;

  @Column()
  created: Date;
}
