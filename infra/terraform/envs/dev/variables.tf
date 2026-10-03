variable "aws_region" {
  description = "Primary AWS region. Undecided (ARCHITECTURE-VERIFICATION-001 M-09); supplied per environment."
  type        = string
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "sit", "uat", "preprod", "prod"], var.environment)
    error_message = "environment must be one of dev, sit, uat, preprod, prod."
  }
}
