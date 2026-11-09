"""add password reset and email verification tokens

Revision ID: 39ac72c08e11
Revises: 6217e823a4d7
Create Date: 2026-11-09 11:45:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "39ac72c08e11"
down_revision = "6217e823a4d7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "traders",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trader_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trader_id"], ["traders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        op.f("ix_password_reset_tokens_trader_id"),
        "password_reset_tokens",
        ["trader_id"],
        unique=False,
    )
    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trader_id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["trader_id"], ["traders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        op.f("ix_email_verification_tokens_trader_id"),
        "email_verification_tokens",
        ["trader_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f("ix_email_verification_tokens_trader_id"),
        table_name="email_verification_tokens",
    )
    op.drop_table("email_verification_tokens")
    op.drop_index(
        op.f("ix_password_reset_tokens_trader_id"),
        table_name="password_reset_tokens",
    )
    op.drop_table("password_reset_tokens")
    op.drop_column("traders", "email_verified")
