provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      application = "serviceform-ai"
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}

# No resources in M00. Modules are added by the build-plan module that needs them.
