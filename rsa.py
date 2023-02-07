#########################################################
# @gilbellosta, 2022-11-14
# Implementing RSA "by hand"
#########################################################

# message
msg = 3

# the two "large" primes
p1 = 7
p2 = 13

# public key
# I choose a number, 5, as part of the public key
# and the other part is p1 * p2
pub = (5, p1 * p2)
a , n = pub

# calculation of the private key
# it must be a number b such that
# x**(a * b) % n == x % n
# for all x
# for that, we need that a*b % totient = 1
totient = (p1 - 1) * (p2 - 1)

tmp = [x for x in range(totient) if a * x % totient == 1]
b = tmp[0]

# testing:
encrypted_msg = msg**a % n

encrypted_msg**b % n

# references:
# https://en.wikipedia.org/wiki/Fermat%27s_little_theorem#Generalizations
# https://artofproblemsolving.com/wiki/index.php/Euler%27s_Totient_Theorem


