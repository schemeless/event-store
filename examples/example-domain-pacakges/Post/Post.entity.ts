import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum PostStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  FAILED = 'FAILED'
}

@Entity()
export class PostEntity {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: false })
  uid: number;

  @Column({ nullable: false })
  userId: string;

  @Column({ nullable: false })
  tokenId: string;

  @Column({ nullable: false })
  title: string;

  @Column({ nullable: false })
  content: string;

  @Column({ type: 'text', nullable: false })
  status: PostStatus;

  @Column({ nullable: false })
  created: Date;

  @Column({ nullable: false })
  updated: Date;
}
