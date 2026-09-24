-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(20) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('PASSENGER', 'DRIVER') NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    INDEX `users_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `refresh_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `driver_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `plate_no` VARCHAR(30) NOT NULL,
    `capacity` TINYINT UNSIGNED NOT NULL,
    `is_online` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicles_driver_id_key`(`driver_id`),
    UNIQUE INDEX `vehicles_plate_no_key`(`plate_no`),
    INDEX `vehicles_is_online_idx`(`is_online`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `areas` (
    `id` SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `latitude` DECIMAL(9, 6) NOT NULL,
    `longitude` DECIMAL(9, 6) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `areas_name_key`(`name`),
    INDEX `areas_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `passenger_id` BIGINT UNSIGNED NOT NULL,
    `pickup_area_id` SMALLINT UNSIGNED NOT NULL,
    `dropoff_area_id` SMALLINT UNSIGNED NOT NULL,
    `seats_requested` TINYINT UNSIGNED NOT NULL,
    `status` ENUM('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED',
    `distance_km` DECIMAL(6, 3) NOT NULL,
    `estimated_fare_paisa` BIGINT UNSIGNED NOT NULL,
    `final_fare_paisa` BIGINT UNSIGNED NULL,
    `payment_method` ENUM('CASH', 'TESLAPAY') NOT NULL DEFAULT 'CASH',
    `cancelled_by` BIGINT UNSIGNED NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matched_at` DATETIME(3) NULL,
    `arrived_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ride_requests_status_pickup_area_id_idx`(`status`, `pickup_area_id`),
    INDEX `ride_requests_passenger_id_requested_at_idx`(`passenger_id`, `requested_at` DESC),
    INDEX `ride_requests_status_requested_at_idx`(`status`, `requested_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pools` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `vehicle_id` BIGINT UNSIGNED NOT NULL,
    `driver_id` BIGINT UNSIGNED NOT NULL,
    `pickup_area_id` SMALLINT UNSIGNED NOT NULL,
    `status` ENUM('FORMING', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'FORMING',
    `capacity` TINYINT UNSIGNED NOT NULL,
    `seats_taken` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `arrived_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pools_driver_id_status_idx`(`driver_id`, `status`),
    INDEX `pools_status_pickup_area_id_idx`(`status`, `pickup_area_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pool_members` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pool_id` BIGINT UNSIGNED NOT NULL,
    `ride_request_id` BIGINT UNSIGNED NOT NULL,
    `seats` TINYINT UNSIGNED NOT NULL,
    `fare_paisa` BIGINT UNSIGNED NOT NULL,
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `left_at` DATETIME(3) NULL,

    UNIQUE INDEX `pool_members_ride_request_id_key`(`ride_request_id`),
    INDEX `pool_members_pool_id_left_at_idx`(`pool_id`, `left_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_status_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ride_request_id` BIGINT UNSIGNED NULL,
    `pool_id` BIGINT UNSIGNED NULL,
    `from_status` VARCHAR(30) NULL,
    `to_status` VARCHAR(30) NOT NULL,
    `actor_user_id` BIGINT UNSIGNED NULL,
    `actor_role` ENUM('PASSENGER', 'DRIVER', 'SYSTEM') NOT NULL,
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ride_status_history_ride_request_id_created_at_idx`(`ride_request_id`, `created_at`),
    INDEX `ride_status_history_pool_id_created_at_idx`(`pool_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ride_request_id` BIGINT UNSIGNED NOT NULL,
    `payer_id` BIGINT UNSIGNED NOT NULL,
    `amount_paisa` BIGINT UNSIGNED NOT NULL,
    `method` ENUM('CASH', 'TESLAPAY') NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `paid_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_ride_request_id_key`(`ride_request_id`),
    INDEX `payments_payer_id_created_at_idx`(`payer_id`, `created_at`),
    INDEX `payments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallets` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `balance_paisa` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wallets_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wallet_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `wallet_id` BIGINT UNSIGNED NOT NULL,
    `direction` ENUM('CREDIT', 'DEBIT') NOT NULL,
    `amount_paisa` BIGINT UNSIGNED NOT NULL,
    `balance_after_paisa` BIGINT UNSIGNED NOT NULL,
    `ride_request_id` BIGINT UNSIGNED NULL,
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `wallet_transactions_wallet_id_created_at_idx`(`wallet_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_requests` ADD CONSTRAINT `ride_requests_passenger_id_fkey` FOREIGN KEY (`passenger_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_requests` ADD CONSTRAINT `ride_requests_cancelled_by_fkey` FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_requests` ADD CONSTRAINT `ride_requests_pickup_area_id_fkey` FOREIGN KEY (`pickup_area_id`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_requests` ADD CONSTRAINT `ride_requests_dropoff_area_id_fkey` FOREIGN KEY (`dropoff_area_id`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pools` ADD CONSTRAINT `pools_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pools` ADD CONSTRAINT `pools_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pools` ADD CONSTRAINT `pools_pickup_area_id_fkey` FOREIGN KEY (`pickup_area_id`) REFERENCES `areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pool_members` ADD CONSTRAINT `pool_members_pool_id_fkey` FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pool_members` ADD CONSTRAINT `pool_members_ride_request_id_fkey` FOREIGN KEY (`ride_request_id`) REFERENCES `ride_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_status_history` ADD CONSTRAINT `ride_status_history_ride_request_id_fkey` FOREIGN KEY (`ride_request_id`) REFERENCES `ride_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_status_history` ADD CONSTRAINT `ride_status_history_pool_id_fkey` FOREIGN KEY (`pool_id`) REFERENCES `pools`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_status_history` ADD CONSTRAINT `ride_status_history_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_ride_request_id_fkey` FOREIGN KEY (`ride_request_id`) REFERENCES `ride_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_payer_id_fkey` FOREIGN KEY (`payer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallets` ADD CONSTRAINT `wallets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_wallet_id_fkey` FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wallet_transactions` ADD CONSTRAINT `wallet_transactions_ride_request_id_fkey` FOREIGN KEY (`ride_request_id`) REFERENCES `ride_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK constraints
--
-- Everything above this line was generated by `prisma migrate diff`, so it
-- matches schema.prisma exactly. Everything below is hand-written, because
-- Prisma's schema language has no syntax for CHECK constraints — and the first
-- one here is the single most important line in this database.
--
-- Requires MySQL 8.0.16 or newer: earlier versions parse CHECK and silently
-- ignore it, which would leave the overbooking guarantee resting on application
-- code alone.
--
-- Note on non-negativity: every money and seat column is UNSIGNED, so MySQL in
-- strict mode already rejects an underflow (decrementing a 0 seat count raises
-- "value is out of range" rather than wrapping). No redundant `>= 0` checks are
-- added for that reason.
-- ═══════════════════════════════════════════════════════════════════════════

-- THE core invariant: a Tesla can never be overbooked.
--
-- The application claims seats with an atomic conditional UPDATE, which is what
-- actually resolves the race between two passengers wanting the last seat. This
-- constraint is the layer beneath that: even a future code path that forgets the
-- WHERE clause, or a hand-written UPDATE at a mysql prompt, cannot corrupt the
-- invariant. It gets an error instead.
ALTER TABLE `pools`
  ADD CONSTRAINT `chk_pools_seats_within_capacity` CHECK (`seats_taken` <= `capacity`);

-- A pool's capacity snapshot must be a capacity a real vehicle could have.
ALTER TABLE `pools`
  ADD CONSTRAINT `chk_pools_capacity_range` CHECK (`capacity` BETWEEN 1 AND 8);

-- A zero-seat or 500-seat rickshaw is data corruption, not a valid state.
ALTER TABLE `vehicles`
  ADD CONSTRAINT `chk_vehicles_capacity_range` CHECK (`capacity` BETWEEN 1 AND 8);

-- A ride to where you already are is not a ride.
ALTER TABLE `ride_requests`
  ADD CONSTRAINT `chk_rides_distinct_areas` CHECK (`pickup_area_id` <> `dropoff_area_id`);

-- Bounded by the largest vehicle we allow.
ALTER TABLE `ride_requests`
  ADD CONSTRAINT `chk_rides_seats_range` CHECK (`seats_requested` BETWEEN 1 AND 4);

-- A trip with no distance cannot be priced.
ALTER TABLE `ride_requests`
  ADD CONSTRAINT `chk_rides_distance_positive` CHECK (`distance_km` > 0);

-- A membership that occupies no seat is meaningless.
ALTER TABLE `pool_members`
  ADD CONSTRAINT `chk_pool_members_seats_positive` CHECK (`seats` >= 1);

-- Every audit entry must describe something.
ALTER TABLE `ride_status_history`
  ADD CONSTRAINT `chk_history_has_subject`
  CHECK (`ride_request_id` IS NOT NULL OR `pool_id` IS NOT NULL);

-- A ledger entry for zero money is noise, not a record.
ALTER TABLE `wallet_transactions`
  ADD CONSTRAINT `chk_wallet_tx_amount_positive` CHECK (`amount_paisa` > 0);
