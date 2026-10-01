import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateTicketDto {
  @IsEmail()
  @IsNotEmpty()
  customer_email: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}