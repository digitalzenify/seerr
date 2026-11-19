import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSharedLists1795100000000 implements MigrationInterface {
  name = 'AddSharedLists1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_list_member" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "listId" integer, "userId" integer, CONSTRAINT "UNIQUE_LIST_MEMBER" UNIQUE ("listId", "userId"), CONSTRAINT "FK_user_list_member_list" FOREIGN KEY ("listId") REFERENCES "user_list" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_user_list_member_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_member_listId" ON "user_list_member" ("listId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_member_userId" ON "user_list_member" ("userId")`
    );

    await queryRunner.query(
      `CREATE TABLE "user_list_item_vote" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "value" varchar NOT NULL, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), "itemId" integer, "userId" integer, CONSTRAINT "UNIQUE_ITEM_VOTE" UNIQUE ("itemId", "userId"), CONSTRAINT "FK_user_list_item_vote_item" FOREIGN KEY ("itemId") REFERENCES "user_list_item" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_user_list_item_vote_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_item_vote_itemId" ON "user_list_item_vote" ("itemId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_item_vote_userId" ON "user_list_item_vote" ("userId")`
    );

    await queryRunner.query(
      `ALTER TABLE "user_list_item" ADD COLUMN "addedById" integer REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_list_item_addedById" ON "user_list_item" ("addedById")`
    );
    // Existing rows belong to the list owner.
    await queryRunner.query(
      `UPDATE "user_list_item" SET "addedById" = (SELECT "ownerId" FROM "user_list" WHERE "user_list"."id" = "user_list_item"."listId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_user_list_item_addedById"`);
    await queryRunner.query(
      `ALTER TABLE "user_list_item" DROP COLUMN "addedById"`
    );
    await queryRunner.query(`DROP INDEX "IDX_user_list_item_vote_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_user_list_item_vote_itemId"`);
    await queryRunner.query(`DROP TABLE "user_list_item_vote"`);
    await queryRunner.query(`DROP INDEX "IDX_user_list_member_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_user_list_member_listId"`);
    await queryRunner.query(`DROP TABLE "user_list_member"`);
  }
}
