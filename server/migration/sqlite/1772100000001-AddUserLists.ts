import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserLists1772100000001 implements MigrationInterface {
  name = 'AddUserLists1772100000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_list" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "description" varchar DEFAULT (''), "sortOrder" integer NOT NULL DEFAULT (0), "isDefault" boolean NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "ownerId" integer, CONSTRAINT "FK_user_list_owner" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_ownerId" ON "user_list" ("ownerId")`
    );
    await queryRunner.query(
      `CREATE TABLE "user_list_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "tmdbId" integer NOT NULL, "mediaType" varchar NOT NULL, "title" varchar NOT NULL DEFAULT (''), "sortOrder" integer NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "listId" integer, "mediaId" integer, CONSTRAINT "UNIQUE_LIST_ITEM" UNIQUE ("tmdbId", "mediaType", "listId"), CONSTRAINT "FK_user_list_item_list" FOREIGN KEY ("listId") REFERENCES "user_list" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_user_list_item_media" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE SET NULL ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_item_tmdbId" ON "user_list_item" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_item_listId" ON "user_list_item" ("listId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_item_mediaId" ON "user_list_item" ("mediaId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_user_list_item_mediaId"`);
    await queryRunner.query(`DROP INDEX "IDX_user_list_item_listId"`);
    await queryRunner.query(`DROP INDEX "IDX_user_list_item_tmdbId"`);
    await queryRunner.query(`DROP TABLE "user_list_item"`);
    await queryRunner.query(`DROP INDEX "IDX_user_list_ownerId"`);
    await queryRunner.query(`DROP TABLE "user_list"`);
  }
}
