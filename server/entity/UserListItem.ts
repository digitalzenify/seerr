import type { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserList } from './UserList';
import { UserListItemVote } from './UserListItemVote';

@Entity()
@Unique('UNIQUE_LIST_ITEM', ['tmdbId', 'mediaType', 'list'])
export class UserListItem {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer' })
  @Index()
  public tmdbId: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column({ type: 'varchar', default: '' })
  public title: string;

  @Column({ type: 'integer', default: 0 })
  public sortOrder: number;

  @ManyToOne(() => UserList, (list) => list.items, {
    onDelete: 'CASCADE',
  })
  @Index()
  public list: UserList;

  @ManyToOne(() => Media, {
    eager: true,
    onDelete: 'SET NULL',
    nullable: true,
  })
  @Index()
  public media: Media;

  /** Who put this title on the list. Null for rows that predate attribution. */
  @ManyToOne(() => User, { eager: true, onDelete: 'SET NULL', nullable: true })
  @Index()
  public addedBy?: User | null;

  @OneToMany(() => UserListItemVote, (vote) => vote.item)
  public votes: UserListItemVote[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<UserListItem>) {
    Object.assign(this, init);
  }
}
